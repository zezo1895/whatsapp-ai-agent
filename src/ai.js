const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
const storage = require('./storage');

// Load database catalog of 1353 products
let catalogProducts = [];
try {
  const catalogPath = path.join(__dirname, '..', 'data', 'catalog_packaging.json');
  if (fs.existsSync(catalogPath)) {
    catalogProducts = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    console.log(`AI loaded ${catalogProducts.length} packaging products with diameters and ounces.`);
  }
} catch (e) {
  console.warn('Could not load catalog_packaging.json:', e.message);
}

class AIService {
  constructor() {
    this.geminiClient = null;
    this.currentKey = null;
  }

  getGeminiClient(apiKey) {
    if (!this.geminiClient || this.currentKey !== apiKey) {
      this.currentKey = apiKey;
      this.geminiClient = new GoogleGenerativeAI(apiKey);
    }
    return this.geminiClient;
  }

  normalizeArabic(t) {
    if (!t) return '';
    return t
      .toLowerCase()
      .replace(/[؟?!.,،:;\-_()[\]{}"'\\\/]/g, ' ')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F]/g, '')
      .trim();
  }

  checkNeedsHuman(text) {
    if (!text) return false;
    const norm = this.normalizeArabic(text);

    // Human/Manager/Call requests
    const callWords = [
      'كلمني', 'اتصل بيا', 'اتصلوا بيا', 'عاوز اكلم حد', 'عايز اكلم حد', 'ممكن حد يكلمني',
      'رقم المدير', 'مسؤول المبيعات', 'مسئول المبيعات', 'حولني', 'عايز اتكلم فون', 'هات رقمك', 'رقمك كام',
      'بني ادم يكلمني', 'عاوز بني ادم', 'مش عاوز بوت', 'مش عايز بوت', 'خدمة العملاء', 'حد يرد عليا'
    ];
    if (callWords.some(w => norm.includes(w))) return true;

    // Commercial bulk quote or custom contract requests requiring sales manager
    const dealWords = [
      'طلبية كبيرة', 'خصم كميات', 'كوتة رسمية', 'فاتورة ضريبية', 'مناقصة', 'عقد توريد',
      'عايز اشتري كمية', 'عاوز اشتري كمية', 'حساب بنكي', 'تحويل بنكي'
    ];
    if (dealWords.some(w => norm.includes(w))) return true;

    return false;
  }

  checkIsClosedOrInactive(text) {
    if (!text) return false;
    const norm = this.normalizeArabic(text);
    const closedWords = [
      'موقفين شغل', 'موقفين', 'وقفنا', 'قافلين', 'صفينا', 'صفى', 'مش شغالين', 'مش شغال',
      'توقفنا', 'مش محتاجين', 'مش مهتم', 'مش بنشتري', 'مش بنشتغل', 'مكتفيين', 'حاليا موقفين',
      'بطلنا', 'قفلنا', 'المحل قفل', 'المطعم قفل'
    ];
    return closedWords.some(w => norm.includes(w));
  }

  checkIsCourtesyFarewell(text) {
    if (!text) return false;
    const norm = this.normalizeArabic(text);

    // Exclude if it's an inquiry
    const inquiryWords = ['كام', 'بكام', 'سعر', 'اسعار', 'عايز', 'عاوز', 'محتاج', 'ابعت', 'ممكن', 'عندكم', 'فين', 'مقاس', 'قطر'];
    if (inquiryWords.some(w => norm.includes(w))) return false;

    const farewellWords = [
      'شكرا', 'شكراً', 'شكرا جدا', 'الف شكر', 'تسلم', 'تسلملي', 'جزاك الله خير',
      'ربنا يخليك', 'حبيبي تسلم', 'ان شاء الله شكرا', 'مشكور', 'يعطيك العافيه', 'تمام شكرا'
    ];
    return norm.length < 35 && farewellWords.some(w => norm.includes(w));
  }

  formatClientName(rawName = null, company = '') {
    if (company && company !== 'غير محدد' && company !== 'شركتكم الموقرة' && company !== 'واتساب مباشر') {
      return `فريق ${company}`;
    }
    return 'فندم';
  }

  checkIsGreetingOrSmallTalk(text) {
    if (!text) return false;
    const norm = this.normalizeArabic(text);
    const greetings = [
      'عامل ايه', 'عامل ايه يا فندم', 'عامل ايه يا باشا', 'عامل ايه يا غالي', 'عامل ايه يا سيدي',
      'ازيك', 'ازيك يا فندم', 'ازيك يا باشا', 'ازيك يا غالي', 'ازيك عامل ايه',
      'اخبارك ايه', 'اخبارك', 'اخبارك ايه يا فندم', 'كل سنه وانت طيب',
      'كلك تمام', 'كله تمام', 'تمام الحمد لله', 'الحمد لله', 'الحمدلله',
      'صباح الخير', 'صباح النور', 'مساء الخير', 'مساء النور',
      'السلام عليكم', 'سلام عليكم', 'عليكم السلام', 'وعليكم السلام', 'مرحبا', 'مرحباً', 'اهلا', 'أهلاً', 'اهلين'
    ];
    return greetings.some(g => norm === g || norm.startsWith(g + ' ') || norm.endsWith(' ' + g));
  }

  findClosestBranch(text, branches = null) {
    if (!branches) {
      const knowledge = storage.getKnowledge();
      branches = knowledge.branches || [];
    }
    if (!branches || branches.length === 0) return null;

    const norm = this.normalizeArabic(text || '');

    // Built-in Egyptian Regional Knowledge Map (so user never needs to manually specify areas)
    const EGYPT_GEO_HUBS = {
      // Delta & Dakahlia hub
      'المنصورة': ['المنصوره', 'المنصورة', 'طلخا', 'ميت غمر', 'السنبلاوين', 'دكرنس', 'بلقاس', 'شربين', 'نبروه', 'اجا', 'أجا', 'منية النصر', 'الجمالية', 'المطرية', 'دمياط', 'راس البر', 'كفر الشيخ', 'بيلا', 'الحامول'],
      'الدقهلية': ['المنصوره', 'المنصورة', 'طلخا', 'ميت غمر', 'السنبلاوين', 'دكرنس', 'بلقاس', 'شربين', 'نبروه', 'اجا', 'أجا', 'منية النصر', 'الجمالية', 'المطرية', 'دمياط', 'راس البر', 'كفر الشيخ', 'بيلا', 'الحامول'],
      // Greater Cairo & Giza hub
      'القاهرة': ['القاهرة', 'القاهره', 'الجيزة', 'الجيزه', 'فيصل', 'الهرم', 'الدقي', 'المهندسين', 'المعادي', 'مدينة نصر', 'مدينه نصر', 'مصر الجديدة', 'مصر الجديده', 'التجمع', 'القاهرة الجديدة', 'الرحاب', 'الشروق', 'بدر', 'مدينتي', 'شبرا', 'وسط البلد', 'الفجالة', 'حلوان', 'اكتوبر', 'أكتوبر', 'زايد', 'الشيخ زايد', 'العجوزة', 'العمرانية', 'بولاق', 'المقطم', 'عين شمس', 'الزيتون', 'العباسية', 'الوايلي', 'شيراتون', 'الزمالك'],
      'الجيزة': ['الجيزة', 'الجيزه', 'فيصل', 'الهرم', 'الدقي', 'المهندسين', 'اكتوبر', 'أكتوبر', 'زايد', 'الشيخ زايد', 'العجوزة', 'العمرانية', 'بولاق الدكرور', 'الحوامدية', 'البدرشين', 'الصف', 'أطفيح', 'وراق العرب', 'إمبابة', 'امبابة'],
      // 10th of Ramadan & Sharqia hub
      'العاشر من رمضان': ['العاشر', 'رمضان', 'الشرقية', 'الشرقيه', 'الزقازيق', 'بلبيس', 'ابو حماد', 'أبو حماد', 'فاقوس', 'ههيا', 'ابو كبير', 'أبو كبير', 'مشتول السوق', 'ديرب نجم', 'الابراهيمية', 'الإبراهيمية', 'القرين', 'العبور', 'الصالحية'],
      'الشرقية': ['العاشر', 'رمضان', 'الشرقية', 'الشرقيه', 'الزقازيق', 'بلبيس', 'ابو حماد', 'أبو حماد', 'فاقوس', 'ههيا', 'ابو كبير', 'أبو كبير', 'مشتول السوق', 'ديرب نجم', 'الابراهيمية', 'الإبراهيمية', 'القرين', 'العبور', 'الصالحية'],
      // Canal cities hub
      'الإسماعيلية': ['الاسماعيلية', 'الإسماعيلية', 'السويس', 'بورسعيد', 'بور فؤاد', 'القنطرة', 'القنطره', 'فايد', 'التل الكبير', 'أبو صوير', 'القصاصين'],
      'السويس': ['السويس', 'العين السخنة', 'الأربعين', 'عتاقة', 'فيصل السويس'],
      'بورسعيد': ['بورسعيد', 'بور فؤاد', 'الزهور', 'الضواحي', 'المناخ', 'الجنوب'],
      // Alexandria & North Coast hub
      'الإسكندرية': ['الاسكندرية', 'الإسكندرية', 'اسكندرية', 'إسكندرية', 'سموحة', 'سيدي جابر', 'ميامي', 'العجمي', 'محرم بك', 'المنتزه', 'الرمل', 'سيدي بشر', 'لوران', 'ستانلي', 'برج العرب', 'كينج مريوط', 'الساحل الشمالي', 'العلمين', 'مطروح'],
      // Gharbia & Middle Delta hub
      'طنطا': ['طنطا', 'المحلة', 'المحله', 'الغربية', 'الغربيه', 'كفر الزيات', 'زفتى', 'سمنود', 'بسيون', 'قطور', 'السنطة'],
      'الغربية': ['طنطا', 'المحلة', 'المحله', 'الغربية', 'الغربيه', 'كفر الزيات', 'زفتى', 'سمنود', 'بسيون', 'قطور', 'السنطة'],
      // Menoufia hub
      'المنوفية': ['المنوفية', 'المنوفيه', 'شبين الكوم', 'السادات', 'مدينة السادات', 'منوف', 'اشمون', 'أشمون', 'قويسنا', 'بركة السبع', 'تلا', 'الشهداء', 'الباجور'],
      // Qalyubia hub
      'القليوبية': ['القليوبية', 'القليوبيه', 'بنها', 'طوخ', 'قليوب', 'شبرا الخيمة', 'شبرا الخيمه', 'الخانكة', 'الخصوص', 'شبين القناطر', 'قها', 'كفر شكر']
    };

    let bestBranch = null;
    let highestScore = 0;

    for (const b of branches) {
      let score = 0;
      const cityNorm = this.normalizeArabic(b.city || '');
      const govNorm = this.normalizeArabic(b.governorate || '');
      const servedNorm = this.normalizeArabic(b.servedAreas || '');
      const nameNorm = this.normalizeArabic(b.name || '');

      // Direct match with branch fields
      const words = [...cityNorm.split(/\s+/), ...govNorm.split(/\s+/), ...servedNorm.split(/[,،\s]+/), ...nameNorm.split(/\s+/)]
        .filter(w => w.length > 2);

      for (const w of words) {
        if (norm.includes(w)) {
          score += 25;
        }
      }

      // Smart AI Egyptian Geographic Mapping:
      // Even if servedAreas is completely EMPTY, the AI automatically checks if the query mentions
      // any town/neighborhood that belongs to this branch's city or governorate!
      for (const [hubKey, affiliatedTowns] of Object.entries(EGYPT_GEO_HUBS)) {
        const normHub = this.normalizeArabic(hubKey);
        const branchMatchesHub = cityNorm.includes(normHub) || govNorm.includes(normHub) || nameNorm.includes(normHub);
        if (branchMatchesHub) {
          for (const town of affiliatedTowns) {
            const normTown = this.normalizeArabic(town);
            if (norm.includes(normTown)) {
              score += 20;
            }
          }
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestBranch = b;
      }
    }

    if (highestScore > 0 && bestBranch) {
      return bestBranch;
    }

    // Default to main factory (العاشر من رمضان) or first branch
    return branches.find(b => (b.name && b.name.includes('العاشر')) || (b.city && b.city.includes('العاشر'))) || branches[0];
  }

  searchCatalog(query, limit = 4) {
    if (!catalogProducts || catalogProducts.length === 0 || !query) return [];
    const norm = this.normalizeArabic(query);

    // Extract diameter (أقطار ملم)
    const dMatch = norm.match(/\b(95|92|75|72|74|70|79|90|100|115|140|160|170|180|110|138|144|181)\b/);
    const diameter = dMatch ? parseInt(dMatch[1]) : null;

    // Extract ounce (أونزات oz)
    const ozMatch = norm.match(/(\d+)\s*(oz|اونز|أونز)/) || norm.match(/(اونز|أونز)\s*(\d+)/);
    const ounce = ozMatch ? parseInt(ozMatch[1] || ozMatch[2]) : null;

    // Extract grams (جرامات/سعات)
    const gMatch = norm.match(/(\d+)\s*(جم|جرام|مل|سم)/);
    const grams = gMatch ? parseInt(gMatch[1]) : null;

    // Extract fraction weight for foam (1/8, 1/4, 1/2, 3/4, 1, 2 كيلو)
    const fMatch = norm.match(/(1\/8|1\/4|1\/2|3\/4|1\.5|1\.1\/2|1|2)\s*كيلو/);
    const foamWeight = fMatch ? fMatch[1] : null;

    // Item type flags
    const isLid = norm.includes('غطا') || norm.includes('غطاء');
    const isCup = norm.includes('كوب') || norm.includes('كاس') || norm.includes('كوباي');
    const isBowl = norm.includes('سلطاني') || norm.includes('بول');
    const isPlate = norm.includes('طبق') || norm.includes('اطباق');
    const isBox = norm.includes('علب') || norm.includes('قالب') || norm.includes('لانش') || norm.includes('مسدس');
    const isFoam = norm.includes('فوم');
    const isStretch = norm.includes('استرتش') || norm.includes('رول');

    // Material flags
    const wantPS = norm.includes('ps') || norm.includes('بوليستيرين');
    const wantPP = norm.includes('pp') || norm.includes('حراري');
    const wantPET = norm.includes('pet') || norm.includes('شفاف');
    const wantKraft = norm.includes('كرتون') || norm.includes('ورق') || norm.includes('كرافت');

    const matches = [];

    for (const p of catalogProducts) {
      let score = 0;

      // Strict dimensional filtering
      if (diameter && p.diameter === diameter) score += 40;
      if (ounce && p.ounce === ounce) score += 40;
      if (grams && p.grams === grams) score += 30;

      if (foamWeight && p.name.includes(foamWeight + ' كيلو')) score += 50;

      // Item type matching
      if (isLid) {
        if (p.name.includes('غطاء')) score += 35;
        else score -= 30;
      }
      if (isCup) {
        if (p.name.includes('كوب') && !p.name.includes('غطاء')) score += 35;
        else if (p.name.includes('كوب')) score += 10;
        else score -= 20;
      }
      if (isBowl) {
        if (p.name.includes('سلطانية') && !p.name.includes('غطاء')) score += 35;
        else if (p.name.includes('سلطانية')) score += 10;
        else score -= 20;
      }
      if (isPlate) {
        if (p.name.includes('طبق')) score += 30;
      }
      if (isBox) {
        if (p.category.includes('علب') || p.name.includes('علب') || p.name.includes('قالب') || p.name.includes('مسدس')) score += 30;
      }
      if (isFoam) {
        if (p.name.includes('فوم')) score += 40;
        else score -= 40;
      }
      if (isStretch) {
        if (p.name.includes('استرتش') || p.name.includes('رول')) score += 40;
      }

      // Material matching
      if (wantPS && (p.material || '').includes('PS')) score += 20;
      if (wantPP && (p.material || '').includes('PP')) score += 20;
      if (wantPET && (p.material || '').includes('PET')) score += 20;
      if (wantKraft && ((p.material || '').includes('كرافت') || (p.material || '').includes('ورق'))) score += 20;

      // Word search
      const stopWords = ['عندكم', 'محتاج', 'عاوز', 'عايز', 'ابعتلي', 'ممكن', 'في', 'لو', 'سمحت', 'على', 'عن'];
      const words = norm.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
      for (const w of words) {
        if (p.name.includes(w)) score += 5;
        if (p.code.toLowerCase() === w) score += 20;
      }

      if (score > 25) {
        matches.push({ product: p, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map(m => m.product);
  }

  buildSystemPrompt(contactInfo = {}, userMessage = '', chatHistory = []) {
    let relevantProductsText = '';
    if (userMessage) {
      const relevant = this.searchCatalog(userMessage, 4);
      if (relevant.length > 0) {
        relevantProductsText = `\nأصناف مطابقة من داتا بيز المصنع (1353 صنف) قد تناسب استفسار العميل:\n` +
          relevant.map(r => `• ${r.name} (كود: ${r.code}) [خامة: ${r.material}]`).join('\n') + '\n';
      }
    }

    // Extract any manual messages written by the human sales representative (sanitizing URLs and tokens to protect privacy)
    let humanContext = '';
    const manualMsgs = (chatHistory || []).filter(m => m.fromMe && !m.isAI && (m.text || '').trim());
    if (manualMsgs.length > 0) {
      const recentManual = manualMsgs.slice(-5).map(m => {
        return (m.text || '')
          .replace(/https?:\/\/[^\s]+/gi, '')
          .replace(/ghp_[a-zA-Z0-9]+/g, '')
          .trim();
      }).filter(t => t.length > 0);

      if (recentManual.length > 0) {
        humanContext = `
=======================================================
🚨 تنبيه أساسي ومحوري (رسائل ممثل المبيعات البشري - صاحب العمل يدوياً):
قام صاحب العمل / مسؤول المبيعات البشري بمراسلة هذا العميل يدوياً بالرسائل التالية:
${recentManual.map(t => `• [رسالة يدوية سابقة من مسؤول المبيعات]: "${t}"`).join('\n')}

تعليمات إلزامية مشددة للذكاء الاصطناعي:
1. اقرأ ما كتبه مسؤول المبيعات البشري بعناية تامة، واجعله هو الأساس الذي تبني عليه ردك الحالي.
2. ممنوع منعاً باتاً مناقضة أو تكرار أو تجاهل أي معلومة أو صنف ذكره مسؤول المبيعات للعميل.
3. إذا كان العميل يستفسر أو يعلق على ما كتبه مسؤول المبيعات، أجب مباشرة كاستكمال لنفس الموضوع بدون أي ارتباك أو إعادة للتعريف بالشركة من الصفر.
=======================================================
`;
      }
    }

    const companyNameClean = (contactInfo.company && contactInfo.company !== 'غير محدد' && contactInfo.company !== 'شركتكم الموقرة' && contactInfo.company !== 'واتساب مباشر') ? contactInfo.company.trim() : '';
    const clientTitle = companyNameClean ? `فريق ${companyNameClean}` : 'يا فندم';

    const knowledge = storage.getKnowledge();
    const branches = knowledge.branches || [];

    let branchesText = '';
    if (branches.length > 0) {
      branchesText = `
=======================================================
📍 قائمة فروع ومعارض ومقرات حكيم جروب الرسمية وروابط خرائط جوجل (Google Maps):
${branches.map((b, i) => `${i + 1}. [${b.name}]
   - المحافظة والمدينة: ${b.city || ''} (${b.governorate || ''})
   - المناطق المخدومة: ${b.servedAreas || b.city || ''}
   - العنوان بالتفصيل: ${b.address || ''}
   - رابط خرائط جوجل (Google Maps Link): ${b.mapLink || 'تواصل للتنسيق: 01144505575'}
   - هاتف التواصل: ${b.phone || '01144505575'}`).join('\n')}

قواعد وإرشادات توجيه العميل لأقرب معرض ورابط اللوكيشن:
1. إذا سأل العميل "عنوانكم فين؟" أو "معارضكم فين؟" أو "أقرب معرض ليا؟" أو ذكر محافظته/مدينته (مثلاً: المنصورة، العاشر، طنطا، الإسماعيلية، القاهرة، فيصل...):
   - اختر المعرض الأقرب جغرافياً لمنطقته من القائمة أعلاه.
   - أجب بود في سطرين: اذكر اسم المعرض وعنوانه، وضع رابط خرائط جوجل (Google Maps Link) الخاص به في الرسالة لكي يضغط عليه ويصل بالـ GPS مباشرة.
2. إذا كان العميل في محافظة بعيدة أو لا يوجد بها معرض مباشر (مثل أسوان، قنا، الأقصر، مرسى مطروح، إلخ):
   - اذكر له باختصار أقرب معرض متاح له (مثل معرض سوهاج لمحافظات الصعيد) مع رابط اللوكيشن لمعاينة الأصناف، أو دعوته لمقر المصانع بالعاشر من رمضان.
   - ⛔ تحذير حاسم وإلزامي: ممنوع منعاً باتاً ذكر أي كلمة عن "شحن" أو "توصيل" أو "أسطول سيارات" أو "لحد باب مقرك"! مفيش أي قصة توصيل إطلاقاً! الاستلام والمعاينة فقط من خلال المعارض الرسمية أو أرض المصنع.
3. إذا سأل العميل عن اللوكيشن أو العنوان بشكل عام دون ذكر محافظته:
   - أعطه لوكيشن مقر المصنع الرئيسي بالعاشر من رمضان، واسأله بلطف عن محافظته لترسل له رابط أقرب معرض مخصص له.
=======================================================
`;
    }

    return `
أنت استشاري مبيعات محترف يمثل صرح «حكيم جروب» (مصانع مواد التعبئة والتغليف وقطاعات الألومنيوم بالعاشر من رمضان).

بيانات المنشأة المستهدفة:
- طريقة النداء والمخاطبة: ${clientTitle}
- اسم المنشأة / المكان: ${contactInfo.company || 'غير محدد'}

${relevantProductsText}
${branchesText}
${humanContext}
قواعد المحادثة والبيع الاستشاري وتصنيف منتجات المصنع (Cold B2B Style - إلزامية ومشددة):
1. أسلوب حواري Cold B2B ذكي ومختصر كإنسان حقيقي (من سطرين إلى 3 أسطر فقط كرسائل واتساب الواقعية):
   - تحدث بنبرة B2B محترمة، واثقة، استشارية وودودة، غير لحوحة أو روبوتية إطلاقاً (Human Cold B2B Consultative).
   - ⛔ قاعدة مخاطبة إلزامية: ممنوع نهائياً وبشكل قاطع مناداة العميل باسم شخص (مثل: يا أستاذ فلان أو يا أحمد أو يا زياد). خاطب العميل دائماً بـ "${clientTitle}" أو "يا فندم" أو باسم المنشأة مباشرة (مثل: "أهلاً بحضرتك يا فندم"، "تحياتنا لـ ${contactInfo.company || 'حضرتكم'}").
   - كل رد لا يتعدى سطرين إلى 3 أسطر فقط، تماماً كشات واتساب طبيعي بين مسؤولي شركات.
   - ممنوع منعاً باتاً حشو الروابط وأرقام الهواتف ورسائل الإعلانات الطويلة دفعة واحدة!
   - إذا سألك العميل "مين معايا؟" أو "انت مين؟": عرّف بنفسك في سطرين فقط: (معاك حكيم جروب لمواد التعبئة والتغليف بالعاشر من رمضان، حابين نتعاون مع ${contactInfo.company || 'حضرتكم'} ونوفر احتياجاتكم مباشرة من المصنع).
   - لا تفترض نشاط العميل ولا تفرض صنفاً بعينه إلا إذا ذكره العميل بنفسه!
   - استمع للعميل، واجعله يوضح احتياجه، واسأله عن المقاسات والأقطار والأونزات أو مسؤول المشتريات.

2. فهم حسابات الأقطار والأونزات والجرامات وخامات المصنع بدقة:
   - الأقطار (Diameters بالملم: 95، 92، 75، 79، 100، 115، 140، 160...):
     * القطر هو أساس تطابق الكوب أو السلطانية مع الغطاء الخاص به!
     * إذا سأل العميل عن أغطية: اسأله فوراً عن قطر الكوب أو السلطانية (قطر 95 ولا 92 ولا 75؟).
   - الأونزات (Ounces / oz: 4oz، 7oz، 8oz، 9oz، 12oz، 16oz، 20oz، 32oz...):
     * خاصة بالأكواب الورقية والبلاستيكية الشفافة والعصائر.
     * إذا سأل العميل عن أكواب: اسأله عن سعة الأونز ومطلوبة ساخن (ورق دبل وول) ولا بارد (بلاستيك شفاف PET) ومع الغطاء ولا بدون.
   - الجرامات والسعات (83 جم، 120 جم، 200 جم، 300 جم، 400 جم، 500 جم):
     * لسلطانيات PP الحرارية والبولات وعلب الميكرويف.
   - أطباق الفوم: (1/8، 1/4، 1/2، 3/4، 1 كيلو، 2 كيلو) ولانش بوكس مقسم (1، 2، 3 عيون).
   - رولات الاسترتش: غذائي (30 سم، 35 سم، 40 سم) وصناعي (50 سم).

3. تصنيف خامات المصنع بدقة (قاعدة أساسية):
   - خامة الـ PS (بوليستيرين صلب): أي صنف في الشيت والكتالوج غير مكتوب عليه PP أو PET أو كرتون/كرافت (مثل عائلة 10.xxx البيضاء والشفافة الصلبة من أكواب وسلطانيات وأغطية كلاسيكية) هو خامة PS صلبة، ناصعة البياض وخفيفة، ممتازة للبارد والحرارة العادية والزبادي والحلويات والأغطية، وغير مخصصة للميكرويف.
   - خامة الـ PP (بولي بروبيلين حراري): المنتجات المكتوب عليها PP (عائلة 10.5xxx)، مرنة ومقاومة للكسر وآمنة للميكرويف ومخصصة للسوائل والوجبات الساخنة.
   - خامة الـ PET (شفاف كريستال): المنتجات المكتوب عليها PET (عائلة 10.7xxx)، فائقة الشفافية واللمعان ومخصصة للعصائر الباردة والآيس كوفي والحلويات والصوصات.
   - كرتون وكرافت ورقي (SW-SPE و SW-DPE): للمشروبات الساخنة والوجبات والتيك أواي.
   - فوم: أطباق اللحوم والدواجن والأسماك واللانش بوكس المقسم.

4. قاعدة صارمة بخصوص الأسعار وعروض الأسعار (ممنوع منعاً باتاً فتح سيرة الأسعار أو عروض الأسعار من نفسك):
   - ممنوع نهائياً أن تبادر أو تذكر كلمة "أسعار" أو "عرض أسعار" أو "كوتة" أو "أظبطلك سعر" في رسائلك للعميل إطلاقاً!
   - ركز فقط على فهم متطلبات العميل من مقاسات، أقطار، خامات، أو توجيهه للمعاينة في المعرض أو تصفح الكتالوج.
   - إذا سأل العميل بنفسه صراحة عن الأسعار ("بكام؟"، "الأسعار إيه؟"، "عاوز عرض أسعار"):
     * القاعدة الإلزامية: رد بحزم وأدب أن «الأسعار متوفرة في معارضنا الرسمية أو في قسم مبيعات الشركة مباشرة هاتفياً أو عبر واتساب: 01144505575».
     * ممنوع تذكر أي أرقام، وممنوع تقول "هنجهزلك عرض سعر" أو "نظبطلك كوتة أسعار"!

5. إرسال الكتالوج ورؤية الشغل والمنتجات فوراً وبدون تردد (مهم جداً وحاسم):
   - إذا طلب العميل رؤية الشغل أو المنتجات أو الأصناف أو الكتالوج (بأي صيغة مثل: "ممكن اشوف الشغل"، "عاوز اشوف الشغل"، "وريني الشغل"، "ابعت الكتالوج"، "في كتالوج أو حاجه اشوف منها"، "ابعتلي صور"، "PDF"):
     * رحّب بالعميل بحفاوة فوراً وأكد له بلباقة واختصار أنه تم إرسال ملف الكتالوج الرسمي (PDF) المرفق لسيادته الآن، ويمكنه أيضاً تصفح الشغل ومواصفات الأصناف أونلاين عبر الرابط الرسمي:
       https://hakim-chi.vercel.app/products
     * واسأله بعد الاطلاع عن الأصناف والمقاسات (أكواب، علب، سلطانيات، أطباق) التي تناسب نشاطه لنركز عليها.
     * ⛔ تحذير: إياك أن تؤجل أو تتجاهل إرسال الكتالوج أو تكتفي بقول "شرفنا في المعرض" عندما يطلب صراحة رؤية الشغل أو الكتالوج!

6. سياسة العينات (مشددة وإلزامية - لا عينات للمطاعم والكافيهات):
   - ممنوع منعاً باتاً عرض أو اقتراح "عينات مجانية" على المطاعم أو الكافيهات أو محلات التجزئة العادية.
   - إذا سأل مطعم أو كافيه عن معاينة خامات: وضح بلباقة أن المعاينة متاحة بزيارة فروع ومعارض الشركة أو مقر المصنع بالعاشر من رمضان أو بالاطلاع على صور ومواصفات الكتالوج المفصلة.
   - للشركات الكبرى والمصانع فقط (Enterprise / Bulk): إذا طلب مسؤول مشتريات شركة كبيرة أو مصنع عينات للاعتماد الفني أو فحص خط الإنتاج، وضح بلباقة أنك ستنسق مع إدارة المبيعات لاعتماد إرسال عينات الفحص الفني لشركتهم الموقرة، دون أن تقطع وعوداً مجانية من تلقاء نفسك.

7. التعامل مع التحيات والسؤال عن الحال (عامل إيه / إزيك / أخبارك):
   - إذا سأل العميل "عامل إيه" أو "إزيك" أو "أخبارك":
     رد بلطف وود مصري راقي: (الحمد لله كله تمام يا ${clientTitle}، تسلم وربنا يعزك ويكرمك يا رب 🌹).
   - ممنوع منعاً باتاً تكرار رسالة التعريف الرسمية (معاك مصانع حكيم جروب...) إذا كنت قد أرسلتها له بالفعل في الشات السابق!
   - تابع مباشرة بسؤاله بلطف عما إذا كان محتاج مقاسات علب أو أكواب معينة لنشاطه أو حابب يزور المعرض لمعاينة الخامات (بدون ذكر كلمة أسعار إطلاقاً).

8. التوجيه لأقرب معرض ورابط خرائط جوجل (Google Maps):
   - عندما يسأل العميل عن مكان المصنع أو أقرب معرض أو أين يعاين المنتجات، زوده فوراً باسم وعنوان أقرب معرض له، وضع رابط خرائط جوجل (Google Maps Link) الخاص به في الرسالة مباشرة.

9. حظر الشحن والتوصيل قطعياً (ممنوع منعاً باتاً مفيش قصة توصيل):
   - ممنوع منعاً باتاً ونهائياً من الـ AI ذكر أي وعود بالشحن أو التوصيل، أو قول "أسطول شحن"، أو "نوصل لحد باب مقرك"، أو "توصيل للجمهورية"!
   - التعامل والمعاينة والاستلام فقط من خلال شبكة معارضنا الرسمية أو الاستلام من أرض المصنع بالعاشر من رمضان.
   - إذا سأل العميل صراحة "بتوصلوا؟" أو "في شحن؟": رد باختصار: "المعاينة والاستلام متاحان من خلال شبكة معارضنا وفروعنا الرسمية أو من أرض المصنع بالعاشر من رمضان، وللتنسيق مع إدارة المبيعات تقدر تتواصل على 01144505575".

10. أمان الروابط والمواقع (قاعدة حاسمة ومشددة 100%):
   - الرابط الوحيد المعتمد لتصفح كتالوج وموقع حكيم جروب هو: https://hakim-chi.vercel.app/products
   - الروابط الأخرى الوحيدة المسموح بها هي روابط خرائط جوجل (Google Maps) الخاصة بفروع ومعارض حكيم جروب الرسمية من القائمة أعلاه فقط.
   - ⛔ ممنوع منعاً باتاً ونهائياً تحت أي ظرف كتابة أو اقتباس أو اختراع أي روابط أخرى (مثل روابط github أو أي لينكات شخصية أو خارجية أخرى).

11. التعامل مع موافقة واستئذان العميل الأولي (عندما يرد العميل بـ: اتفضل / اتفضل يا فندم / نعم / بخصوص إيه / تفضل / سامعك / قول):
   - ⛔ ممنوع منعاً باتاً سرد أو إلقاء قائمة منتجاتنا في وجه العميل (ممنوع تقول بنوفر أكواب ورقية وبلاستيك وعلب وجبات وسلطانيات وأطباق واسترتش)!
   - الرد الإلزامي المباشر لبدء الحوار الاستكشافي الذكي:
     اشكره بلباقة، وعرّف أن مصنعنا بالعاشر من رمضان، واسأله فوراً عن خامة العبوات الأكثر استخداماً لديهم:
     «تسلم يا فندم وربنا يعزك 🌹 إحنا مصنعنا بالعاشر من رمضان؛ نقدر نعرف من حضرتك بتستخدموا عبوات إيه أكتر لنشاط المكان، بلاستيك ولا فوم ولا كرتون؟»
   - ومن إجابة العميل التالية (سواء اختار بلاستيك، أو كرتون، أو فوم): ابدأ معه الحوار في تفاصيل المقاسات والأصناف الخاصة بتلك الخامة فقط.
`.trim();
  }

  sanitizeOutput(text) {
    if (!text) return '';
    let cleaned = text
      .replace(/أهיל/g, 'أهلاً')
      .replace(/יל/g, 'لاً')
      .replace(/[\u0590-\u05FF]/g, '')
      .trim();

    // Absolute privacy protection: replace any unauthorized URL (github, personal pages, etc.)
    // with the official Hakim Group catalog link
    cleaned = cleaned.replace(/https?:\/\/[^\s)]+/gi, (url) => {
      if (url.includes('hakim-chi.vercel.app') || url.includes('google.com/maps') || url.includes('maps.app.goo.gl')) {
        return url;
      }
      return 'https://hakim-chi.vercel.app/products';
    });

    return cleaned;
  }

  checkIsCatalogRequest(text) {
    if (!text) return false;
    const norm = this.normalizeArabic(text.toLowerCase());
    
    // Explicit phrases for seeing work/products/catalog
    const catalogPhrases = [
      'كتالوج', 'الكتالوج', 'كاتلوج', 'الكاتلوج', 'كتلوج', 'الكتلوج', 'catalog', 'catalogue',
      'اشوف الشغل', 'نشوف الشغل', 'اشوف شغلكم', 'نشوف شغلكم', 'وريني الشغل', 'فرجني ع الشغل', 'فرجني عالشغل',
      'اشوف المنتجات', 'اشوف الاصناف', 'اشوف البضاعه', 'اشوف البضاعة', 'اشوف المقاسات', 'اشوف عينات',
      'عايز اشوف', 'عاوز اشوف', 'ممكن اشوف', 'نقدر نشوف', 'حابب اشوف', 'بدنا نشوف',
      'ابعت الكتالوج', 'ابعتلي الكتالوج', 'ابعت الكاتلوج', 'ابعتلي الكاتلوج', 'ممكن كتالوج', 'في كتالوج', 'عندكم كتالوج', 'عندكو كتالوج',
      'ابعت صور', 'ابعتلي صور', 'وريني صور', 'صور الشغل', 'صور المنتجات', 'صور الاصناف', 'صور العلب', 'صور الاكواب',
      'pdf', 'بي دي اف', 'قايمه', 'قائمة', 'منيو', 'بروفايل', 'profile'
    ];
    if (catalogPhrases.some(phrase => norm.includes(phrase))) return true;

    // Single trigger words
    const words = norm.split(/[\s,،.؟!]+/);
    const triggerWords = ['كتالوج', 'كاتلوج', 'كتلوج', 'pdf', 'صور', 'صورة', 'صوره', 'الصور', 'بروفايل'];
    if (words.some(w => triggerWords.includes(w))) return true;

    // "اشوف" or "وريني" or "فرجني" or "ابعتلي" combined with work/packaging/items
    if (norm.includes('اشوف') || norm.includes('وريني') || norm.includes('فرجني') || norm.includes('ابعتلي')) {
      if (norm.includes('شغل') || norm.includes('عين') || norm.includes('صنف') || norm.includes('منتج') || norm.includes('بضاع') || norm.includes('حاجه') || norm.includes('حاجة') || norm.includes('مقاس')) {
        return true;
      }
    }

    return false;
  }

  async generateReply(contactInfo, chatHistory = [], userMessage) {
    const settings = storage.getSettings();
    let apiKey = settings.apiKey ? settings.apiKey.trim() : '';

    if (!apiKey) {
      return this.sanitizeOutput(this.generateMockFallbackReply(contactInfo, userMessage, chatHistory));
    }

    try {
      let reply = '';
      if (settings.provider === 'openai') {
        reply = await this.callOpenAI(settings, contactInfo, chatHistory, userMessage);
      } else {
        reply = await this.callGemini(settings, contactInfo, chatHistory, userMessage, apiKey);
      }
      return this.sanitizeOutput(reply);
    } catch (err) {
      console.warn('AI API Error (falling back to fast smart local responder):', err.message);
      return this.sanitizeOutput(this.generateMockFallbackReply(contactInfo, userMessage, chatHistory));
    }
  }

  async getInitialOutreachMessageAsync(contactInfo) {
    const settings = storage.getSettings();
    let apiKey = settings.apiKey ? settings.apiKey.trim() : '';

    if (settings.useAIUniqueOutreach !== false && apiKey) {
      try {
        const uniqueMsg = await this.generateUniqueAIOutreach(contactInfo, settings);
        if (uniqueMsg && uniqueMsg.length > 25) {
          return this.sanitizeOutput(uniqueMsg);
        }
      } catch (err) {
        console.warn('AI unique outreach generation error (falling back to Spintax):', err.message);
      }
    }
    return this.getInitialOutreachMessage(contactInfo);
  }

  async generateUniqueAIOutreach(contactInfo, settings) {
    const company = (contactInfo.company && contactInfo.company !== 'واتساب مباشر' && contactInfo.company !== 'شركتكم الموقرة' && contactInfo.company !== 'غير محدد') ? contactInfo.company.trim() : '';
    const city = contactInfo.city || '';
    const activity = contactInfo.activity || contactInfo.category || '';

    const prompt = `
أنت ممثل مبيعات B2B محترف ولبق جداً يمثل شركة «حكيم جروب» لمواد التعبئة والتغليف بالعاشر من رمضان.
المطلوب كتابة رسالة افتتاحية قصيرة جداً (سطرين فقط، 15 إلى 25 كلمة) للتواصل الأولي (Cold Outreach) عبر واتساب مع منشأة/مكان تجاري، بأسلوب حواري مهذب واستئذاني بحت لجذب العميل لفتح حوار والرد، دون رمي أي منتجات في وجهه ودون أي بيع مباشر.

بيانات المنشأة:
- اسم المنشأة / المكان: ${company || 'نشاطكم الموقر'}
- طريقة النداء والمخاطبة: ${company ? `يا فندم / تحياتنا لفريق ${company}` : 'يا فندم'}
- المدينة أو المحافظة: ${city || 'مصر'}
- نوع النشاط: ${activity || 'أغذية ومشروبات'}

القواعد الصارمة والجوهرية (إلزامية ومشددة 100%):
1. ⛔ ممنوع نهائياً ذكر أي اسم شخص (مثل: يا أستاذ فلان أو يا أحمد أو يا زياد). المخاطبة حصراً: بـ "يا فندم" أو بذكر اسم المنشأة فقط (مثل: "السلام عليكم يا فندم، تحياتنا لفريق ${company || 'المكان'}" أو "أهلاً بحضرتك يا فندم").
2. ⛔ ممنوع منعاً باتاً رمي المنتجات أو اقتراح أصناف محددة في الرسالة الأولى! (ممنوع ذكر علب كرافت، أكواب دبل وول، سلطانيات صوص، أو أي صنف). الرسالة الأولى ليست لعرض منتجات بل للاستئذان وفتح باب الحوار الودي فقط.
3. 🎯 الأسلوب الحواري والاستئذان (طلب دقيقة من وقته باحترام لجذبه للرد):
   يجب أن تنتهي الرسالة بطلب إذن مهذب ومريح يجعله يرد ببساطة بـ (اتفضل يا فندم / اتفضل).
   صيغ ختامية إلزامية للاستئذان:
   - "حضرتك متاح أخد من وقتك دقيقة سريعة بخصوص تغليف وخامات المكان عندكم؟"
   - "متاح أخد من وقت حضرتك دقايق بسيطة نستفسر عن حاجة سريعة تخص توريدات التعبئة والتغليف؟"
   - "لو وقت حضرتك يسمح ناخد دقيقة بخصوص خامات التغليف والتعبئة اللي بتسحبوها للمكان؟"
   - "متاح وقت حضرتك في دقيقة لو حابين تراجعوا خامات التعبئة مباشرة من المصنع؟"
4. الهيكل النموذجي للرسالة (سطرين فقط):
   [تحية راقية لاسم المنشأة أو يا فندم]
   [معاك شركة حكيم جروب لمواد التعبئة والتغليف بالعاشر من رمضان] + [استئذان مهذب: متاح أخد من وقتك دقيقة بخصوص التعبئة والتغليف للمكان؟]
5. ⛔ ممنوع منعاً باتاً ذكر: (أسعار، عرض أسعار، كوتة، شحن، توصيل، عينات).
6. لا تضع أي روابط أو أرقام هواتف.
7. اكتب نص الرسالة فقط بدون أي فواصل أو علامات تنصيص أو شروحات.
`.trim();

    if (settings.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 150
        })
      });
      const data = await response.json();
      return data.choices[0].message.content.trim();
    } else {
      const client = this.getGeminiClient(settings.apiKey);
      const model = client.getGenerativeModel({ model: settings.model || 'gemini-flash-lite-latest' });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
  }

  getInitialOutreachMessage(contactInfo, variationIndex = null) {
    const company = (contactInfo.company && contactInfo.company !== 'شركتكم الموقرة' && contactInfo.company !== 'واتساب مباشر' && contactInfo.company !== 'غير محدد') ? contactInfo.company.trim() : '';

    const greetings = company ? [
      `السلام عليكم يا فندم، تحياتنا لفريق ${company} 🌹`,
      `أهلاً بحضرتك يا فندم، تحياتنا وتقديرنا لإدارة ${company} 🌹`,
      `السلام عليكم ورحمة الله، يومكم سعيد وكل التوفيق لـ ${company} 🌹`,
      `أهلاً بحضرتك يا فندم، نتشرف بالتواصل مع فريق ${company} 🌹`,
      `مساء الخير يا فندم، تحياتنا لحضرتك ولكل فريق ${company} 🌹`,
      `السلام عليكم يا فندم، كل التوفيق والنجاح لـ ${company} 🌹`,
      `أهلاً بيك يا فندم، تحياتنا العطرة لـ ${company} 🌹`,
      `تحياتنا لحضرتك يا فندم ولفريق عمل ${company} 🌹`,
      `السلام عليكم يا فندم، يا رب تكونوا في ${company} بأحسن صحة وحال 🌹`,
      `مساء الورد يا فندم، تحياتنا وتقديرنا لنشاطكم الموقر في ${company} 🌹`
    ] : [
      `السلام عليكم ورحمة الله وبركاته يا فندم 🌹`,
      `أهلاً بحضرتك يا فندم، يومك سعيد 🌹`,
      `السلام عليكم يا فندم، أتمنى لحضرتك دوام التوفيق والنجاح 🌹`,
      `مساء الخير يا فندم، نتشرف بالتواصل مع حضراتكم 🌹`,
      `أهلاً بيك يا فندم، تحياتنا العطرة وتقديرنا لحضرتك 🌹`,
      `السلام عليكم يا فندم، يا رب تكون بأحسن صحة وحال 🌹`
    ];

    const intros = [
      `معاك شركة حكيم جروب لمواد التعبئة والتغليف (مصنعنا بالعاشر من رمضان).`,
      `مع حضرتك شركة حكيم جروب لتصنيع وتوريد مواد التعبئة والتغليف بالعاشر من رمضان.`,
      `بنكلمك من صرح حكيم جروب لمستلزمات وخامات التعبئة والتغليف بالعاشر من رمضان.`,
      `معاك شركة حكيم جروب لخامات ومستلزمات التعبئة والتغليف بالعاشر من رمضان.`,
      `مع حضرتك إدارة مبيعات مصانع حكيم جروب للتعبئة والتغليف بالعاشر من رمضان.`,
      `معاك حكيم جروب لتصنيع حلول وخامات التعبئة والتغليف بالعاشر من رمضان.`
    ];

    const hooks = [
      `حضرتك متاح أخد من وقتك دقيقة سريعة بخصوص تغليف وخامات المكان عندكم؟`,
      `هل متاح أخد من وقت حضرتك دقايق بسيطة نستفسر عن حاجة سريعة تخص توريدات التعبئة والتغليف؟`,
      `لو وقت حضرتك يسمح ناخد دقيقة بخصوص خامات التغليف والتعبئة اللي بتسحبوها للمكان؟`,
      `متاح أخد من وقت حضرتك دقيقة لو حابين تراجعوا توريدات وخامات التعبئة مباشرة من المصنع؟`,
      `هل مناسب وقت حضرتك في دقيقة سريعة نستأذنك في استفسار يخص عبوات وتغليف نشاطكم؟`,
      `لو مناسب وقت حضرتك نستأذنك في دقيقة سريعة بخصوص خامات التعبئة والتغليف الخاصة بكم؟`,
      `حضرتك متاح أخد دقيقة من وقتك ندردش بخصوص توريدات العبوات للمكان مباشرة من المصنع؟`,
      `متاح وقت حضرتك في دقيقة بسيطة نستأذنك بخصوص خامات وتغليف المكان؟`
    ];

    const g = greetings[Math.floor(Math.random() * greetings.length)];
    const intro = intros[Math.floor(Math.random() * intros.length)];
    const hook = hooks[Math.floor(Math.random() * hooks.length)];

    return `${g}\n${intro} ${hook}`;
  }

  async generateFollowupMessage(contactInfo, chatHistory = []) {
    const hasHistory = Array.isArray(chatHistory) && chatHistory.length > 0;

    if (!hasHistory) {
      return this.getInitialOutreachMessage(contactInfo);
    }

    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg && !lastMsg.fromMe) {
      return await this.generateReply(contactInfo, chatHistory, lastMsg.text);
    }

    const settings = storage.getSettings();
    let apiKey = settings.apiKey ? settings.apiKey.trim() : '';

    let instruction = '';
    if (lastMsg && lastMsg.fromMe && !lastMsg.isAI) {
      instruction = `قام مسؤول المبيعات البشري للتو بإرسال الرسالة التالية للعميل يدوياً: "${lastMsg.text}". اقرأها بعناية، واكتب رسالة متابعة ذكية جداً وموجزة (سطرين فقط) تبني على كلامه باحترافية وتدفع العميل للتجاوب بود بدون إلحاح وبدون تكرار ما قاله، وبدون عرض عينات مجانية.`;
    } else {
      instruction = `اكتب رسالة متابعة ذكية جداً وقصيرة (سطرين فقط) تستفسر بلطف عما إذا كان العميل قد اطلع على المقاسات والكتالوج أو يحتاج أي توضيح بخصوص الأصناف والطلبيات، دون فتح سيرة أسعار أو عرض أسعار ودون عرض عينات مجانية.`;
    }

    if (!apiKey) {
      return this.generateMockFollowupReply(contactInfo, chatHistory);
    }

    try {
      if (settings.provider === 'openai') {
        return await this.callOpenAI(settings, contactInfo, chatHistory, instruction);
      } else {
        return await this.callGemini(settings, contactInfo, chatHistory, instruction, apiKey);
      }
    } catch (err) {
      return this.generateMockFollowupReply(contactInfo, chatHistory);
    }
  }

  generateMockFollowupReply(contactInfo, chatHistory = []) {
    const company = (contactInfo.company && contactInfo.company !== 'شركتكم الموقرة' && contactInfo.company !== 'واتساب مباشر' && contactInfo.company !== 'غير محدد') ? contactInfo.company.trim() : '';
    const greetingName = 'يا فندم';

    const lastMsg = chatHistory && chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
    if (lastMsg && lastMsg.fromMe && !lastMsg.isAI) {
      return `أهلاً بحضرتك ${greetingName}! بنتابع مع سيادتك بخصوص ما ذكرناه لحضرتك في رسالتنا السابقة، ونحب نعرف لو شفت المقاسات أو تحب نوضح لحضرتك أي تفاصيل لنشاط ${company || 'حضرتكم'}؟ 🌹`;
    }

    return `أهلاً بحضرتك ${greetingName}! بنتابع مع سيادتك ونحب نطمن لو شفت الكتالوج والمقاسات أو حابب نوضح لحضرتك أي تفاصيل تناسب شغل ${company || 'نشاطكم'}؟ 🌹`;
  }

  async callGemini(settings, contactInfo, chatHistory, userMessage, apiKey) {
    const client = this.getGeminiClient(apiKey);
    let modelName = settings.model || 'gemini-flash-lite-latest';
    
    if (['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'].includes(modelName)) {
      modelName = 'gemini-flash-lite-latest';
    }

    const systemInstruction = this.buildSystemPrompt(contactInfo, userMessage, chatHistory);

    const generateWithModel = async (mName) => {
      const model = client.getGenerativeModel({
        model: mName,
        systemInstruction: systemInstruction
      });

      const contents = [];
      const recentHistory = chatHistory.slice(-12);

      for (const msg of recentHistory) {
        const prefix = (msg.fromMe && !msg.isAI) ? '[رسالة كتبها مسؤول المبيعات يدوياً]: ' : '';
        contents.push({
          role: msg.fromMe ? 'model' : 'user',
          parts: [{ text: prefix + msg.text }]
        });
      }

      contents.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini timeout for ${mName}`)), 15000)
      );

      const result = await Promise.race([
        model.generateContent({ contents }),
        timeoutPromise
      ]);

      const response = await result.response;
      return response.text().trim();
    };

    try {
      return await generateWithModel(modelName);
    } catch (err) {
      if (modelName !== 'gemini-flash-lite-latest') {
        console.warn(`Gemini ${modelName} failed (${err.message}), retrying with gemini-flash-lite-latest...`);
        return await generateWithModel('gemini-flash-lite-latest');
      }
      throw err;
    }
  }

  async callOpenAI(settings, contactInfo, chatHistory, userMessage) {
    const systemInstruction = this.buildSystemPrompt(contactInfo, userMessage, chatHistory);
    const messages = [{ role: 'system', content: systemInstruction }];

    const recentHistory = chatHistory.slice(-12);
    for (const msg of recentHistory) {
      const prefix = (msg.fromMe && !msg.isAI) ? '[رسالة كتبها مسؤول المبيعات يدوياً]: ' : '';
      messages.push({
        role: msg.fromMe ? 'assistant' : 'user',
        content: prefix + msg.text
      });
    }
    messages.push({ role: 'user', content: userMessage });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 300
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  generateMockFallbackReply(contactInfo, userMessage, chatHistory = []) {
    const companyNameClean = (contactInfo.company && contactInfo.company !== 'غير محدد' && contactInfo.company !== 'شركتكم الموقرة' && contactInfo.company !== 'واتساب مباشر') ? contactInfo.company.trim() : '';
    const clientTitle = companyNameClean ? `فريق ${companyNameClean}` : 'يا فندم';
    const greetingName = (clientTitle && clientTitle !== 'فندم') ? clientTitle : 'يا فندم';
    const text = (userMessage || '').trim().toLowerCase();
    const normText = this.normalizeArabic(text);

    // Audio & Image friendly acknowledgment
    if (text.includes('[رسالة صوتية]')) {
      return `أهلاً بحضرتك ${greetingName} 🌹\nاستلمنا الفويس نوت، وثواني وزميلي في قسم المبيعات هيسمعها ويرد على استفسار حضرتك بالتفاصيل والأسعار مباشرة.`;
    }
    if (text.includes('[صورة]')) {
      return `تمام يا فندم تسلم 🌹\nاستلمنا الصورة، وبيتم مراجعة العينة والمقاس المطلوب حالياً لنفيد حضرتك بالمتوفر والأنسب لنشاطكم مباشرة من المصنع.`;
    }

    // If client is replying to a human representative's manual message
    const manualMsgs = (chatHistory || []).filter(m => m.fromMe && !m.isAI && (m.text || '').trim());
    if (manualMsgs.length > 0 && ['تمام', 'ماشي', 'اوك', 'اوكي', 'موافق', 'ابعتلي', 'ابعت', 'فين', 'بكام', 'السعر', 'شكرا'].some(w => normText.includes(w))) {
      return `تسلم ${greetingName} ومتابعين مع سيادتك بناءً على ما ذكره لك مسؤول المبيعات فوراً. تحب نوضح لحضرتك أي مقاسات أو مواصفات معينة؟ 🌹`;
    }

    // 0. Permission / Go ahead replies (اتفضل / اتفضل يا فندم / نعم / بخصوص ايه / خير)
    const permissionWords = ['اتفضل', 'تفضل', 'نعم', 'بخصوص ايه', 'بخصوص إيه', 'خير', 'اتكلم', 'سامعك', 'قول', 'معاك'];
    if (permissionWords.some(w => normText.includes(w))) {
      return `تسلم ${greetingName} وربنا يعزك 🌹 إحنا مصنعنا بالعاشر من رمضان؛ نقدر نعرف من حضرتك بتستخدموا عبوات إيه أكتر لنشاط المكان، بلاستيك ولا فوم ولا كرتون؟`;
    }

    // 0.a Material follow-up answers (كرتون / بلاستيك / فوم)
    if (normText.includes('كرتون') || normText.includes('ورق')) {
      return `ممتاز ${greetingName}! متوفر من المصنع علب كرافت للوجبات والتيك أواي، وأكواب ورقية دبل وسنجل بكافة الأونزات.\nبتحتاجوا علب كرافت مقسمة ولا سادة، ومقاسات أكواب كام أونز لنشاطكم؟`;
    }
    if (normText.includes('بلاستيك') || normText.includes('شفاف')) {
      return `تمام ${greetingName}! متوفر عبوات ميكرويف حرارية PP، وسلطانيات صوصات وسوشي، وأكواب عصائر مثلجة PET.\nبتحتاجوا عبوات ميكرويف حرارية ولا سلطانيات وأكواب شفافة؟`;
    }
    if (normText.includes('فوم')) {
      return `تمام ${greetingName}! متوفر أطباق فوم بجميع الأوزان (أنصاص، كيلوات) ولانش بوكس مقسم عيون.\nبتحتاجوا أطباق فوم مقاسات إيه بالظبط لنشاطكم؟`;
    }

    // 0.b Social greetings & small talk (عامل إيه / إزيك / أخبارك / صباح الخير...)
    if (this.checkIsGreetingOrSmallTalk(text)) {
      const hasPreviousIntro = (chatHistory || []).some(m => m.fromMe && (m.text.includes('حكيم جروب') || m.text.includes('مصانع') || m.text.includes('السلام عليكم')));
      if (hasPreviousIntro) {
        return `الحمد لله كله تمام وبخير ${greetingName}، تسلم وربنا يعزك ويكرمك يا رب 🌹\nكنا بنستفسر لو بتسحبوا كرتون أو مقاسات علب أو أكواب معينة نقدر نوفرها لنشاط حضرتك؟`;
      }
      return `الحمد لله تمام وبخير ${greetingName}، تسلم وربنا يبارك فيك 🌹\nمعاك حكيم جروب للتعبئة والتغليف والألومنيوم بالعاشر، كنا حابين نعرف إيه أهم الأصناف والعبوات اللي بتسحبوها عادة نقدر نخدمكم فيها؟`;
    }
    const words = normText.split(/\s+/);

    // 1. Inactive or closed business
    if (this.checkIsClosedOrInactive(text)) {
      return `ربنا ييسر لكم الحال وترجعوا أقوى من الأول وتفتحوا على خير يا رب 🌹 رقمنا مع حضرتك وفي أي وقت تحتاجوا أي خامات لتجهيز الشغل الجديد، نتشرف بخدمتكم دائماً.`;
    }

    // 1.b Compliments and polite farewells (Never pitch products after farewell!)
    if (this.checkIsCourtesyFarewell(text) || ['بحبك', 'حبيبي', 'تسلم', 'شكرا', 'شكراً', 'تسلملي', 'يا غالي'].some(w => normText.includes(w))) {
      return `العفو يا غالي، تسلم وربنا يعزك ويسعد يومك دائماً يا رب 🌹 تحت أمركم في أي وقت.`;
    }

    // 1.b Inquiries about material types (PS, PP, PET, Microwave)
    if (normText.includes('ميكرويف') || (normText.includes('الفرق بين') && (normText.includes('ps') || normText.includes('pp')))) {
      return `أهلاً بك ${greetingName}! خامات المصنع مقسمة بدقة:
1. بلاستيك PP حراري: يتحمل أعلى درجات الحرارة وآمن للميكرويف ومقاوم للكسر للوجبات والشوربات الساخنة.
2. بلاستيك PS صلب: ناصع وخفيف للبارد والحرارة العادية والزبادي والحلويات والأغطية (غير مخصص للميكرويف).
3. بلاستيك PET شفاف: فائق اللمعان والشفافية الكريستالية للعصائر المثلجة والحلويات.

تحب نرشح لحضرتك عبوات PP ميكرويف حرارية ولا خامات PS صلبة؟`;
    }

    // 1.c Cartons and Kraft Paper packaging (كرتون، ورق، كرافت)
    if (['كرتون', 'كرافت', 'ورق', 'ورقي', 'دبل'].some(w => normText.includes(w))) {
      return `بنقدم ${greetingName} تشكيلة كاملة من الأكواب الورقية (دبل وول وسنجل) للمشروبات الساخنة والباردة، بالإضافة لعلب الوجبات والتيك أواي الكرتون والكرافت ومستلزمات الشحن بمقاسات مختلفة.\n\nتحب نبعتلك تفاصيل المقاسات والأكواد الكرتون ولا بتدور على صنف معين بالذات؟ 🌹`;
    }

    // 2. Specific Direct Search by Dimensions (Diameters, Ounces, Grams, Foam)
    const dMatch = normText.match(/\b(95|92|75|72|74|70|79|90|100|115|140|160|170|180|110|138|144|181)\b/);
    const ozMatch = normText.match(/(\d+)\s*(oz|اونز|أونز)/) || normText.match(/(اونز|أونز)\s*(\d+)/);
    const gMatch = normText.match(/(\d+)\s*(جم|جرام|مل|سم)/);
    const foamMatch = normText.match(/(1\/8|1\/4|1\/2|3\/4|1\.5|1\.1\/2|1|2)\s*كيلو/);

    const hasSpecificDimension = dMatch || ozMatch || gMatch || foamMatch;
    if (hasSpecificDimension) {
      const matched = this.searchCatalog(text, 3);
      if (matched && matched.length > 0) {
        const itemsList = matched.map(m => `• ${m.name} (كود: ${m.code}) [خامة: ${m.material}]`).join('\n');
        return `أهلاً بك ${greetingName}! متوفر لدينا من المصنع مباشرة:\n${itemsList}\n\nتحب نحدد مع حضرتك الكمية والمواصفات المطلوبة لتجهيز الطلبية؟`;
      }
    }

    // 3. Cups inquiry (Ask for Ounce & Diameter & Hot/Cold)
    if (['كوب', 'اكواب', 'أكواب', 'كاسات', 'كوبايات'].some(w => normText.includes(w)) && !normText.includes('غطا')) {
      return `أهلاً بك ${greetingName}! متوفر لدينا جميع مقاسات الأكواب الورقية (كرافت ودبل وسينجل SW-SPE / SW-DPE) والأكواب البلاستيكية الشفافة (PET وPP).\n\nحضرتك محتاج سعة كام أونز تقريباً؟ (4oz، 7oz، 8oz، 9oz، 12oz، 16oz...) وللمشروبات الساخنة ولا الباردة والعصائر؟`;
    }

    // 4. Lids inquiry (Ask for Cup/Bowl Diameter in mm)
    if (['غطاء', 'غطا', 'غطيان', 'اغطية', 'أغطية'].some(w => normText.includes(w))) {
      return `أهلاً بك ${greetingName}! متوفر لدينا أغطية لجميع المقاسات بخامات (PET شفاف، PP حراري، PS) فلات وبومبيه ووردة وشاليمو.\n\nقطر الكوب أو السلطانية كام ملم عند حضرتك؟ (قطر 95، 92، 75، 115...) علشان نحدد الغطاء المتطابق تماماً؟`;
    }

    // 5. Food bowls / Meal containers inquiry (Ask for Capacity in Grams)
    if (['سلطانية', 'سلطانيه', 'سلطانيات', 'بولات', 'علب وجبات', 'علب طعام'].some(w => normText.includes(w))) {
      return `أهلاً بك ${greetingName}! متوفر لدينا سلطانيات PP حرارية بأغطيتها محكمة الغلق بجميع السعات (83 جم، 120 جم، 200 جم، 300 جم، 400 جم، حتى 500 جم). وعلب وجبات كرتون كرافت ومفصلية.\n\nحضرتك بتحتاج سعة كام جرام أو أونز تقريباً لنشاطك؟`;
    }

    // 6. Foam plates inquiry (Ask for Weights in fractions of Kilo)
    if (normText.includes('فوم') || normText.includes('لانش بوكس')) {
      return `أهلاً بك ${greetingName}! متوفر لدينا أطباق فوم بجميع الأوزان (1/8، 1/4، 1/2، 3/4، 1 كيلو، 2 كيلو) بألوان الأبيض والأسود والأصفر، ولانش بوكس مقسم (1، 2، 3 عيون).\n\nحضرتك محتاج أطباق فوم مقاسات إيه بالظبط؟`;
    }

    // 7. Stretch film inquiry (Food vs Industrial)
    if (normText.includes('استرتش') || normText.includes('رول')) {
      return `أهلاً بك ${greetingName}! متوفر لدينا رولات استرتش غذائي PE/PVC عالي الشفافية والمطاطية بعرض (30 سم، 35 سم، 40 سم) بأوزان 2 و3 و5 كجم، ورولات استرتش صناعي 50 سم.\n\nمحتاج الاسترتش الغذائي لتغليف الأطعمة ولا الصناعي للبالتات؟`;
    }

    // 8. General search on the 1353 catalog products
    const matchedCatalog = this.searchCatalog(text, 3);
    if (matchedCatalog && matchedCatalog.length > 0) {
      const itemsList = matchedCatalog.map(m => `• ${m.name} (كود: ${m.code}) [خامة: ${m.material}]`).join('\n');
      return `أهلاً بك ${greetingName}! متوفر لدينا الأصناف التالية بالمصنع:\n${itemsList}\n\nتحب نحدد مع حضرتك المقاس والكمية المطلوبة لنشاطكم؟`;
    }

    // 9. Prices inquiry (Showrooms or Sales dept only)
    if (['سعر', 'بكام', 'اسعار', 'أسعار', 'تكلفه', 'كوته', 'عرض سعر', 'عرض اسعار'].some(w => normText.includes(w))) {
      return `أهلاً بك ${greetingName}! 🌹\nالأسعار متوفرة في معارضنا الرسمية أو من خلال قسم مبيعات الشركة مباشرة هاتفياً أو عبر واتساب على: 01144505575.`;
    }

    // 10. Catalog / Website link inquiry
    const hasCatalogWord = this.checkIsCatalogRequest(text)
      || ['كتالوج', 'كاتلوج', 'كتلوج', 'pdf', 'موقع', 'لينك', 'رابط', 'تصفح'].some(w => normText.includes(w))
      || words.some(w => ['صور', 'صوره', 'الصور'].includes(w));
    if (hasCatalogWord) {
      return `تحت أمرك ${greetingName}! تم إرسال ملف الكتالوج الرسمي (PDF) المرفق لسيادتكم حالاً، وتقدر تتصفح كافة عبواتنا ومقاساتها وصورها أيضاً عبر موقعنا الرسمي:
👉 https://hakim-chi.vercel.app/products

قولي بعد ما تشوفه إيه الأصناف أو المقاسات اللي مهتم بيها لنشاطك نركز عليها؟ 🌹`;
    }

    // 11. Location / Showroom inquiry & Branches with Google Maps Links
    const isLocationInquiry = ['عنوان', 'مكان', 'مقر', 'فين', 'معرض', 'معارض', 'مصنع', 'فرع', 'فروع', 'اشوف', 'اعاين', 'ازوركم', 'لوكيشن', 'اللوكيشن', 'خريطه', 'خرائط', 'gps'].some(w => normText.includes(w));
    const knownCities = ['القاهره', 'الجيزه', 'الاسكندريه', 'اسكندريه', 'طنطا', 'المنصوره', 'الزقازيق', 'العاشر', 'رمضان', 'الشرقيه', 'الدقهليه', 'الغربيه', 'الاسماعيليه', 'السويس', 'بورسعيد', 'فيصل', 'الهرم', 'مدينه نصر', 'مصر الجديده', 'المهندسين', 'المعادي', 'حلوان', 'شبرا', 'الدقي', 'اكتوبر', 'زايد', 'دمياط', 'المحله', 'بنها', 'كفر الشيخ'];
    const mentionedCity = knownCities.some(c => normText.includes(c));

    if (isLocationInquiry || mentionedCity) {
      const knowledge = storage.getKnowledge();
      const branches = knowledge.branches || [];
      const matchedBranch = this.findClosestBranch(text, branches);

      if (matchedBranch && (mentionedCity || normText.includes('فرع') || normText.includes('معرض') || normText.includes('اقرب') || normText.includes('لوكيشن') || normText.includes('مكان'))) {
        return `تنورنا وتشرفنا ${greetingName}! 🌹\nأقرب فرع ومعرض لحضرتك هو [${matchedBranch.name}] (${matchedBranch.address || matchedBranch.city}).\n📍 رابط اللوكيشن على خرائط جوجل:\n${matchedBranch.mapLink || 'تواصل معنا للتنسيق: 01144505575'}\nيشرفنا حضور حضرتك للمعاينة المباشرة.`;
      }

      const mainFactory = (branches && branches.length > 0)
        ? (branches.find(b => (b.name && b.name.includes('العاشر')) || (b.city && b.city.includes('العاشر'))) || branches[0])
        : null;
      const mainLink = mainFactory ? mainFactory.mapLink : 'https://maps.app.goo.gl/HakimGroupFactory10th';

      return `تنورنا وتشرفنا ${greetingName}! 🏭\nمقر المصنع والمجمع الصناعي الرئيسي بالعاشر من رمضان:\n📍 ${mainLink}\nولدينا شبكة معارض منتشرة بالمحافظات. حضرتك متواجد في أي محافظة لنرسل لك رابط اللوكيشن لأقرب معرض لك؟ 🌹`;
    }

    // 12. Shipping / Delivery inquiry (Strictly forbidden - Pick up from branches or factory only)
    if (['شحن', 'توصيل', 'بتوصلوا', 'توصلوا', 'بتشحنوا', 'تشحنوا', 'دليفري', 'يوصل'].some(w => normText.includes(w))) {
      return `أهلاً بك ${greetingName} 🌹\nالمعاينة والاستلام متوفران من خلال شبكة معارضنا وفروعنا الرسمية أو من أرض المصنع بالعاشر من رمضان.\nوللتنسيق مع إدارة المبيعات تفضل بالتواصل هاتفياً أو عبر واتساب: 01144505575.`;
    }

    // 13. General Welcome & Open Inquiry (Never repeat intro if already said!)
    const hasPreviousOutreach = (chatHistory || []).some(m => m.fromMe);
    if (hasPreviousOutreach) {
      return `تحت أمرك ${greetingName} 🌹 كنا حابين نعرف إيه أهم المقاسات أو الأصناف اللي بتحتاجوها لنشاطكم نقدر نوفرها لحضرتك؟`;
    }
    return `أهلاً بك ${greetingName} 🌹 معاك مصانع حكيم جروب للتعبئة والتغليف بالعاشر من رمضان، حابين نعرف إيه أهم الأصناف أو العبوات اللي بتسحبوها عادة نقدر نوفرها لحضراتكم مباشرة من المصنع؟`;
  }
}

module.exports = new AIService();
