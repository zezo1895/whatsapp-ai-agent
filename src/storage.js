const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'archive_contacts.json');

const defaultSettings = {
  provider: 'gemini',
  apiKey: process.env.GEMINI_API_KEY || '',
  model: 'gemini-3.5-flash-lite',
  minDelaySeconds: 60,
  maxDelaySeconds: 180,
  batchSize: 5,
  batchCooldownMinutes: 10,
  dailySafetyLimit: 25,
  warmupMode: false,
  useAIUniqueOutreach: true,
  initialMessageTemplate: '{greeting}\nمعاك مصانع حكيم جروب للتعبئة والتغليف بالعاشر من رمضان.',
  autoReplyEnabled: true,
  dailyMessageLimit: 25,
  catalogLink: 'https://hakim-chi.vercel.app/products',
  catalogPdfPath: path.join(DATA_DIR, 'uploads', 'catalog.pdf'),
  catalogMode: 'both',
  enableDynamicGreetings: true
};

const defaultKnowledge = {
  companyName: 'حكيم جروب - Hakim Group (مواد التعبئة والتغليف وقطاعات الألومنيوم)',
  about: 'صرح صناعي متكامل يضم مصانع متخصصة في قطاعين رئيسيين: 1) تصنيع وتوريد مواد التعبئة والتغليف البلاستيكية والورقية والكرتون (أكواب، أطباق، سلطانيات، علب، رولات استرتش). 2) سحب ودهان قطاعات الألومنيوم المعمارية والصناعية وتصنيع الاسطمبات.',
  products: `
1. قطاع مواد التعبئة والتغليف (Packaging & Disposables):
- أكواب: أكواب كرافت ورقية (SW-DPE)، أكواب ربل عصير، أكواب PET شفافة بشفة وفتحة شاليمو، أكواب بلاستيك شفافة ومطبوعة.
- أطباق فوم: أطباق فوم بجميع المقاسات (1/8، 1/4، 1/2، كيلو) وألوان متعددة (أبيض، أصفر، أحمر، أسود، أخضر).
- أطباق ريزو وكريستال: أطباق ريزو كريستال PP سوداء وشفافة، أطباق بكعب 200/330 وغيرها.
- سلطانيات طعام: سلطانيات ساخن وشوربة، سلطانيات كشري وحلويات (102 جم، 165/115، 400 جم) بأغطية محكمة.
- علب وجبات مفصلية ومستطيلة: علب مسدسة بغطاء مفصلي PS، علب ميكرويف مقسمة ومستطيلة.
- أغطية لجميع المقاسات: أغطية مسطحة، أغطية قبة، أغطية بفتحة شاليمو لجميع مقاسات الأكواب والسلطانيات.
- رولات وبكر تغليف: استرتش فيلم غذائي (PE/PVC) لتغليف الأغذية واللحوم، رولات شيت وبكر شرينك.
- كرتون مضلع ومستلزمات مطاعم وفنادق: شوك وملاعق وسكاكين بلاستيك وكرتون شحن مطبوع ومخصص.

2. قطاع الألومنيوم والاسطمبات (Aluminum Profiles & Molds):
- قطاعات الألومنيوم للواجهات والشبابيك والأبواب (أنظمة منزلقة ومفصلية وكيرتن وول).
- اسطمبات متطورة وسحب ألومنيوم حسب الطلب.
- معالجة الأسطح ودهان المقاطع (الأنودة والبودر كوتنج بكافة الألوان).
`,
  faqs: `س: هل بتوردوا لمطاعم وكافيهات ومصانع مواد غذائية؟
ج: نعم، نحن مورد رئيسي لأكبر سلاسل المطاعم، الكافيهات، مصانع الأغذية، محلات الحلويات، والورش والموزعين في مصر، ونوفر طباعة اللوجو على العلب والأكواب.

س: ما هي خامات التعبئة والتغليف المتوفرة لديكم؟
ج: نوفر منتجات بخامات غذائية معتمدة بالكامل تشمل: الورق والكرافت، البولي بروبيلين PP (آمن للميكرويف)، PET، البوليسترين PS، والفوم.

س: هل متاح معاينة واستلام في المحافظات؟
ج: نعم، متاح عبر شبكة معارضنا وفروعنا المنتشرة في المحافظات أو من مقر المصنع بالعاشر من رمضان.

س: إزاي أعرف أسعار المنتجات أو أطلب كوتة / عرض سعر؟
ج: شرفنا بتحديد الأصناف المطلوبة والكميات التقريبية (بالكرتونة أو الألف قطعة)، وسنقوم فوراً بإرسال الكتالوج وعرض سعر رسمي مخصص لحضرتك.`,
  systemPrompt: `أنت مساعد مبيعات ذكي، لبق ومحترف جداً على واتساب تمثل مجموعة شركاتنا (مواد التعبئة والتغليف وقطاعات الألومنيوم).
تحدث باللغة العربية بلهجة مصرية تجارية راقية ومحترمة تليق بممثل مبيعات خبير.
إذا سألك العميل عن أي منتج من منتجات التعبئة والتغليف (مثل الأكواب، الأطباق الفوم، علب الوجبات، سلطانيات، أغطية، استرتش، كرتون) أو عن قطاعات الألومنيوم، جاوبه بدقة واعرض عليه المتاح والمقاسات والألوان، واسأله بلطف عن نشاطه (مطعم، كافيه، مصنع، تاجر، ورشة) والكمية التقريبية ليحصل على أفضل سعر مناسب.`
};

function readJson(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
  return defaultVal;
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${file}:`, err.message);
  }
}

class Storage {
  constructor() {
    this.settings = readJson(SETTINGS_FILE, defaultSettings);
    this.knowledge = readJson(KNOWLEDGE_FILE, defaultKnowledge);
    this.contacts = readJson(CONTACTS_FILE, []);
    this.chats = readJson(CHATS_FILE, {});
    this.archiveContacts = readJson(ARCHIVE_FILE, []);
    this.archivePastDaysContacts();
  }

  getArchiveContacts() {
    return this.archiveContacts;
  }

  saveArchiveContacts(archive) {
    this.archiveContacts = archive;
    writeJson(ARCHIVE_FILE, this.archiveContacts);
  }

  archivePastDaysContacts() {
    const todayStr = new Date().toISOString().split('T')[0];
    const existingArchive = readJson(ARCHIVE_FILE, []);
    const archivedPhoneMap = new Map();
    existingArchive.forEach(item => {
      const cleanP = (item.phone || '').replace(/\D/g, '');
      if (cleanP) archivedPhoneMap.set(cleanP, item);
    });

    const remainingToday = [];
    let movedCount = 0;

    for (const c of this.contacts) {
      const cleanPhone = (c.phone || '').replace(/\D/g, '');
      const chatMsgs = this.chats[cleanPhone] || this.chats[c.phone] || [];
      const lastMsg = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : null;
      const sentTime = c.sentAt || (lastMsg ? lastMsg.timestamp : null);

      let isPast = false;
      let sentDateStr = '';
      if (sentTime) {
        const sDate = new Date(sentTime).toISOString().split('T')[0];
        if (sDate < todayStr) {
          isPast = true;
          sentDateStr = sDate;
        }
      }

      if (isPast) {
        movedCount++;
        const archivedItem = {
          ...c,
          phone: cleanPhone,
          name: c.name || 'يا فندم',
          sentAt: sentTime,
          sentDate: sentDateStr,
          lastMessage: lastMsg ? lastMsg.text : '',
          messagesCount: chatMsgs.length,
          status: c.status === 'replied' ? 'replied' : 'sent',
          archivedAt: new Date().toISOString()
        };
        archivedPhoneMap.set(cleanPhone, archivedItem);
      } else {
        remainingToday.push(c);
      }
    }

    // Also check chats.json for past chats not in contacts.json
    Object.keys(this.chats).forEach(p => {
      const cleanP = p.replace(/\D/g, '');
      if (cleanP.length >= 8 && !archivedPhoneMap.has(cleanP)) {
        const msgs = this.chats[p];
        if (msgs && msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          const sDate = new Date(lastMsg.timestamp).toISOString().split('T')[0];
          if (sDate < todayStr) {
            archivedPhoneMap.set(cleanP, {
              id: 'arch_' + cleanP,
              name: 'يا فندم',
              company: 'واتساب مباشر',
              phone: cleanP,
              sentAt: lastMsg.timestamp,
              sentDate: sDate,
              lastMessage: lastMsg.text,
              messagesCount: msgs.length,
              status: msgs.some(m => !m.fromMe) ? 'replied' : 'sent',
              archivedAt: new Date().toISOString()
            });
          }
        }
      }
    });

    this.contacts = remainingToday;
    this.archiveContacts = Array.from(archivedPhoneMap.values());
    writeJson(CONTACTS_FILE, this.contacts);
    writeJson(ARCHIVE_FILE, this.archiveContacts);

    return {
      todayCount: this.contacts.length,
      archiveCount: this.archiveContacts.length,
      movedCount
    };
  }

  restoreContactFromArchive(phone) {
    if (!phone) return null;
    const clean = phone.replace(/\D/g, '');
    const idx = this.archiveContacts.findIndex(c => (c.phone || '').replace(/\D/g, '') === clean);
    if (idx === -1) return null;

    const [archived] = this.archiveContacts.splice(idx, 1);
    writeJson(ARCHIVE_FILE, this.archiveContacts);

    // Add back to today's contacts as pending
    const restored = {
      ...archived,
      status: 'pending',
      sentAt: null,
      lastError: null
    };
    this.contacts.push(restored);
    writeJson(CONTACTS_FILE, this.contacts);
    return restored;
  }

  getSettings() {
    return this.settings;
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    writeJson(SETTINGS_FILE, this.settings);
    return this.settings;
  }

  getKnowledge() {
    this.knowledge = readJson(KNOWLEDGE_FILE, this.knowledge || defaultKnowledge);
    return this.knowledge;
  }

  saveKnowledge(newKnowledge) {
    this.knowledge = { ...this.knowledge, ...newKnowledge };
    writeJson(KNOWLEDGE_FILE, this.knowledge);
    return this.knowledge;
  }

  getContacts() {
    return this.contacts;
  }

  saveContacts(contacts) {
    this.contacts = contacts;
    writeJson(CONTACTS_FILE, this.contacts);
    return this.contacts;
  }

  upsertContactFromWhatsApp(phone, name, extra = {}) {
    // Only update name if contact already exists (uploaded via Excel).
    // Do NOT create new contacts from WhatsApp sync.
    if (!phone) return;
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 8) return;

    const existingIdx = this.contacts.findIndex(c => {
      const p = c.phone.replace(/\D/g, '');
      return p === cleanPhone || p.endsWith(cleanPhone) || cleanPhone.endsWith(p);
    });

    if (existingIdx !== -1) {
      if (!this.contacts[existingIdx].name) {
        this.contacts[existingIdx].name = 'يا فندم';
        writeJson(CONTACTS_FILE, this.contacts);
      }
    }
    // No longer auto-creates contacts from WhatsApp sync
  }

  deleteContact(phone) {
    if (!phone) return false;
    const clean = phone.replace(/\D/g, '');
    const beforeCount = this.contacts.length;
    this.contacts = this.contacts.filter(c => {
      const p = (c.phone || '').replace(/\D/g, '');
      return p !== clean && !p.endsWith(clean) && !clean.endsWith(p);
    });
    if (this.contacts.length !== beforeCount) {
      writeJson(CONTACTS_FILE, this.contacts);
      return true;
    }
    return false;
  }

  updateContactStatus(phone, status, extra = {}) {
    let found = false;
    const cleanPhone = phone.replace(/\D/g, '');
    this.contacts = this.contacts.map(c => {
      const cPhone = c.phone.replace(/\D/g, '');
      if (cPhone === cleanPhone || cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone)) {
        found = true;
        return { ...c, status, ...extra };
      }
      return c;
    });
    if (found) {
      writeJson(CONTACTS_FILE, this.contacts);
    }
    return found;
  }

  getChats(phone = null) {
    if (phone) {
      const clean = phone.replace(/\D/g, '');
      return this.chats[clean] || [];
    }
    return this.chats;
  }

  ensureChatExists(phone, contactName = null) {
    const clean = phone.replace(/\D/g, '');
    if (!this.chats[clean]) {
      this.chats[clean] = [];
      writeJson(CHATS_FILE, this.chats);
    }
    // Don't auto-create contacts — only update existing ones
  }

  addMessage(phone, message) {
    const clean = phone.replace(/\D/g, '');
    if (!this.chats[clean]) {
      this.chats[clean] = [];
    }

    // Check if duplicate message already exists
    const recent = this.chats[clean].slice(-10);
    const msgText = (message.text || '').trim();
    const isDuplicate = recent.some(m => {
      if ((m.text || '').trim() === msgText) {
        const timeDiff = Math.abs(new Date(m.timestamp || 0) - new Date(message.timestamp || Date.now()));
        if (m.fromMe === message.fromMe && timeDiff < 30000) return true;
        if (timeDiff < 4000) return true;
      }
      return false;
    });
    if (isDuplicate) return null;

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      timestamp: message.timestamp || new Date().toISOString(),
      ...message
    };
    this.chats[clean].push(msgObj);

    if (this.chats[clean].length > 100) {
      this.chats[clean] = this.chats[clean].slice(-100);
    }
    writeJson(CHATS_FILE, this.chats);
    return msgObj;
  }

  saveChats(chats) {
    this.chats = chats;
    writeJson(CHATS_FILE, this.chats);
  }
}

module.exports = new Storage();
