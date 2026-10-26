const xlsx = require('xlsx');
const storage = require('./storage');

class CampaignManager {
  constructor() {
    this.status = 'idle'; // 'idle' | 'running' | 'paused' | 'completed'
    this.currentIndex = 0;
    this.timer = null;
    this.io = null;
    this.whatsappService = null;
    this.sessionSentCount = 0;
    this.isCooldown = false;
  }

  setDependencies(io, whatsappService) {
    this.io = io;
    this.whatsappService = whatsappService;
  }

  getTodaySentCount() {
    const contacts = storage.getContacts();
    const today = new Date().toISOString().slice(0, 10);
    return contacts.filter(c => c.sentAt && c.sentAt.startsWith(today)).length;
  }

  parseExcel(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawData || rawData.length === 0) {
      throw new Error('الملف فارغ أو لا يحتوي على صفوف بيانات.');
    }

    const contacts = [];
    rawData.forEach((row, idx) => {
      // Find columns flexibly by common Arabic/English names
      let name = '';
      let company = '';
      let phone = '';
      let city = '';
      let activity = '';
      let products = '';
      let extraNotes = '';

      for (const [key, val] of Object.entries(row)) {
        const k = key.trim().toLowerCase();
        const v = String(val).trim();
        if (!v) continue;

        if (['اسم العميل', 'الاسم', 'المسؤول', 'name', 'contact', 'person'].some(t => k.includes(t))) {
          name = v;
        } else if (['شركة', 'الشركة', 'اسم الشركة', 'المنشأة', 'المصنع', 'المطعم', 'company', 'organization', 'factory'].some(t => k.includes(t))) {
          company = v;
        } else if (!['حالة', 'status', 'state'].some(t => k.includes(t)) && ['هاتف', 'موبايل', 'تليفون', 'واتساب', 'واتس', 'phone', 'mobile', 'whatsapp', 'tel'].some(t => k.includes(t)) && /\d/.test(v)) {
          phone = v;
        } else if (['مدينة', 'منطقة', 'محافظة', 'عنوان', 'city', 'region', 'area', 'location'].some(t => k.includes(t))) {
          city = v;
        } else if (['نوع النشاط', 'نشاط', 'مجال', 'activity', 'category', 'field'].some(t => k.includes(t))) {
          activity = v;
        } else if (['منتجات', 'المنتج', 'أصناف', 'اصناف', 'اهتمام', 'product', 'items'].some(t => k.includes(t))) {
          products = v;
        } else if (['ملاحظات', 'تفاصيل', 'notes', 'comment'].some(t => k.includes(t))) {
          extraNotes = v;
        }
      }

      // If phone wasn't detected by header, check if any column contains a phone-like number
      if (!phone) {
        for (const val of Object.values(row)) {
          const digits = String(val).replace(/\D/g, '');
          if (digits.length >= 10 && digits.length <= 15) {
            phone = String(val).trim();
            break;
          }
        }
      }

      // Clean phone number (strip spaces, dashes, ensure valid format)
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.startsWith('01') && cleanPhone.length === 11) {
        // Egyptian mobile starting with 01 -> add country code 2
        cleanPhone = '2' + cleanPhone;
      }

      const noteParts = [];
      if (city) noteParts.push(`المدينة: ${city}`);
      if (activity) noteParts.push(`النشاط: ${activity}`);
      if (products) noteParts.push(`الأصناف المطلوبة: ${products}`);
      if (extraNotes) noteParts.push(extraNotes);
      const combinedNotes = noteParts.join(' | ');

      if (cleanPhone) {
        contacts.push({
          id: 'cnt_' + (idx + 1) + '_' + Date.now(),
          name: name || 'عزيزنا العميل',
          company: company || 'شركتكم الموقرة',
          phone: cleanPhone,
          originalPhone: phone,
          city: city || '',
          activity: activity || '',
          products: products || '',
          notes: combinedNotes,
          status: 'pending', // 'pending' | 'sent' | 'replied' | 'failed'
          sentAt: null,
          lastError: null,
          autoReply: true
        });
      }
    });

    if (contacts.length === 0) {
      throw new Error('لم يتم العثور على أرقام هواتف صالحة في الملف.');
    }

    storage.saveContacts(contacts);
    return contacts;
  }

  formatInitialMessage(contact, customTemplate = null) {
    const settings = storage.getSettings();
    const ai = require('./ai');
    if (!customTemplate) {
      return ai.getInitialOutreachMessage(contact);
    }
    const template = customTemplate || settings.initialMessageTemplate || '';

    const company = (contact.company && contact.company !== 'شركتكم الموقرة' && contact.company !== 'واتساب مباشر' && contact.company !== 'غير محدد') ? contact.company.trim() : '';
    const addressing = company ? `فريق ${company}` : 'يا فندم';

    let text = template
      .replace(/{name}/g, addressing)
      .replace(/{company}/g, company || 'شركتكم الموقرة')
      .replace(/{notes}/g, contact.notes || '');

    return text.trim();
  }

  async start() {
    if (this.status === 'running') return;

    if (!this.whatsappService || !this.whatsappService.isConnected()) {
      throw new Error('يجب توصيل الواتساب أولاً عبر مسح الـ QR Code قبل بدء الحملة.');
    }

    const contacts = storage.getContacts();
    const pendingContacts = contacts.filter(c => c.status === 'pending');

    if (pendingContacts.length === 0) {
      throw new Error('لا توجد جهات اتصال معلقة للإرسال.');
    }

    // Safety Gate: Check Daily Anti-Ban Limit
    const settings = storage.getSettings();
    const todaySent = this.getTodaySentCount();
    const dailyLimit = Math.max(10, parseInt(settings.dailySafetyLimit, 10) || 25);

    if (todaySent >= dailyLimit) {
      throw new Error(`⚠️ حماية الحساب من الحظر: تم إرسال ${todaySent} رسالة اليوم وهو الحد الأقصى الآمن اليومي (${dailyLimit} رسالة). ننصح بالانتظار حتى الغد لحماية رقمك تماماً.`);
    }

    this.sessionSentCount = 0;
    this.isCooldown = false;
    this.status = 'running';
    this.broadcastStatus();
    this.processNext();
  }

  pause() {
    this.status = 'paused';
    this.isCooldown = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.broadcastStatus();
  }

  reset() {
    this.pause();
    this.status = 'idle';
    this.sessionSentCount = 0;
    this.isCooldown = false;
    const contacts = storage.getContacts().map(c => ({
      ...c,
      status: 'pending',
      sentAt: null,
      lastError: null
    }));
    storage.saveContacts(contacts);
    this.broadcastStatus();
    if (this.io) {
      this.io.emit('contacts_updated', contacts);
    }
  }

  async processNext() {
    if (this.status !== 'running') return;

    const contacts = storage.getContacts();
    const nextContactIndex = contacts.findIndex(c => c.status === 'pending');

    if (nextContactIndex === -1) {
      this.status = 'completed';
      this.isCooldown = false;
      this.broadcastStatus();
      if (this.io) {
        this.io.emit('campaign_completed', { total: contacts.length });
      }
      return;
    }

    // Safety Gate: Check Daily Limit
    const settings = storage.getSettings();
    const todaySent = this.getTodaySentCount();
    const dailyLimit = Math.max(10, parseInt(settings.dailySafetyLimit, 10) || 25);

    if (todaySent >= dailyLimit) {
      console.log(`[Anti-Ban Protection] Daily safety limit reached (${todaySent}/${dailyLimit}). Pausing campaign to protect account.`);
      this.status = 'paused';
      this.isCooldown = false;
      this.broadcastStatus();
      if (this.io) {
        this.io.emit('campaign_paused_limit', {
          todaySent,
          dailyLimit,
          message: `تم الوصول إلى الحد الأقصى اليومي الآمن (${dailyLimit} رسالة). توقفت الحملة تلقائياً لحماية رقمك من الحظر.`
        });
      }
      return;
    }

    const contact = contacts[nextContactIndex];

    // Generate 100% unique personalized message using AI
    const ai = require('./ai');
    let message = '';
    try {
      if (settings.useAIUniqueOutreach !== false) {
        message = await ai.getInitialOutreachMessageAsync(contact);
      } else {
        message = this.formatInitialMessage(contact);
      }
    } catch (e) {
      message = this.formatInitialMessage(contact);
    }

    try {
      const cleanTarget = (contact.phone || '').replace(/\D/g, '');
      const myNum = (this.whatsappService && this.whatsappService.myNumber ? this.whatsappService.myNumber : '').replace(/\D/g, '');

      // Guard 1: Never message own number
      if (myNum && (cleanTarget === myNum || myNum.endsWith(cleanTarget) || cleanTarget.endsWith(myNum))) {
        throw new Error('محاولة إرسال لرقمك الشخصي المتصل بالواتساب');
      }

      // Guard 2: Verify number is registered on WhatsApp
      if (this.whatsappService && typeof this.whatsappService.checkOnWhatsApp === 'function') {
        const isOnWhatsApp = await this.whatsappService.checkOnWhatsApp(contact.phone);
        if (isOnWhatsApp === false) {
          throw new Error('الرقم غير مسجل على واتساب (رقم وهمي أو غير صالح)');
        }
      }

      console.log(`Sending campaign message to ${contact.name} (${contact.phone})...`);
      await this.whatsappService.sendMessage(contact.phone, message);

      contact.status = 'sent';
      contact.sentAt = new Date().toISOString();
      storage.updateContactStatus(contact.phone, 'sent', { sentAt: contact.sentAt });
      this.sessionSentCount++;

      // Add to local chat history
      const savedMsg = storage.addMessage(contact.phone, {
        fromMe: true,
        text: message,
        isAI: false
      });

      if (this.io) {
        this.io.emit('contact_sent', { contactId: contact.id, phone: contact.phone });
        this.io.emit('contacts_updated', storage.getContacts());
        if (savedMsg) {
          this.io.emit('chat_message', { phone: contact.phone, message: savedMsg });
        }
        this.io.emit('chats_updated', storage.getChats());
      }
    } catch (err) {
      console.error(`Failed to send to ${contact.phone}:`, err.message);
      contact.status = 'failed';
      contact.lastError = err.message;
      storage.updateContactStatus(contact.phone, 'failed', { lastError: err.message });
      if (this.io) {
        this.io.emit('contacts_updated', storage.getContacts());
      }
    }

    // Schedule next message with dynamic humanized interval & smart batch cooldown
    if (this.status === 'running') {
      const remainingContacts = storage.getContacts().filter(c => c.status === 'pending');
      if (remainingContacts.length === 0) {
        this.status = 'completed';
        this.isCooldown = false;
        this.broadcastStatus();
        return;
      }

      const batchSize = Math.max(3, parseInt(settings.batchSize, 10) || 5);
      const cooldownMins = Math.max(5, parseInt(settings.batchCooldownMinutes, 10) || 10);

      let delayMs = 0;
      let isCooldown = false;

      // Quick skip for failed / invalid numbers without waiting full interval
      if (contact.status === 'failed') {
        delayMs = 3000 + Math.floor(Math.random() * 2000);
        console.log(`Contact failed/invalid. Skipping to next target in ${(delayMs / 1000).toFixed(0)} seconds...`);
      } else if (this.sessionSentCount > 0 && this.sessionSentCount % batchSize === 0) {
        // Smart Batch Break after every N messages
        isCooldown = true;
        const cooldownVariance = Math.floor(Math.random() * 120) - 60; // -60s to +60s
        delayMs = Math.max(300, (cooldownMins * 60 + cooldownVariance)) * 1000;
        console.log(`🛡️ [Anti-Ban Cooldown] Sent ${this.sessionSentCount} messages. Resting for ${(delayMs / 60000).toFixed(1)} minutes to bypass WhatsApp heuristics...`);
      } else {
        // Safe Humanized Delay (60 to 180 seconds + random jitter)
        const min = Math.max(60, parseInt(settings.minDelaySeconds, 10) || 60);
        const max = Math.max(min + 30, parseInt(settings.maxDelaySeconds, 10) || 180);
        const randomJitter = Math.floor(Math.random() * 25);
        delayMs = (Math.floor(Math.random() * (max - min + 1)) + min + randomJitter) * 1000;
        console.log(`Waiting ${(delayMs / 1000).toFixed(0)} seconds before next message (Safe Humanized Interval)...`);
      }

      this.isCooldown = isCooldown;

      const nextTarget = remainingContacts[0];
      const nextTargetName = nextTarget ? (nextTarget.company || nextTarget.name || 'العميل القادم') : 'العميل القادم';

      if (this.io) {
        this.io.emit('campaign_waiting', {
          nextInSeconds: Math.round(delayMs / 1000),
          isCooldown: isCooldown,
          sessionSentCount: this.sessionSentCount,
          nextContact: nextTargetName
        });
      }

      this.timer = setTimeout(() => {
        this.isCooldown = false;
        this.processNext();
      }, delayMs);
    }
  }

  broadcastStatus() {
    if (this.io) {
      const contacts = storage.getContacts();
      const summary = {
        status: this.status,
        total: contacts.length,
        sent: contacts.filter(c => c.status === 'sent').length,
        replied: contacts.filter(c => c.status === 'replied').length,
        failed: contacts.filter(c => c.status === 'failed').length,
        pending: contacts.filter(c => c.status === 'pending').length
      };
      this.io.emit('campaign_status', summary);
    }
  }

  getStatusSummary() {
    const contacts = storage.getContacts();
    return {
      status: this.status,
      total: contacts.length,
      sent: contacts.filter(c => c.status === 'sent').length,
      replied: contacts.filter(c => c.status === 'replied').length,
      failed: contacts.filter(c => c.status === 'failed').length,
      pending: contacts.filter(c => c.status === 'pending').length
    };
  }
}

module.exports = new CampaignManager();
