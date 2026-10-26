const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  getHistoryMsg,
  downloadHistory
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const storage = require('./storage');
const ai = require('./ai');

const SESSION_DIR = path.join(__dirname, '..', 'data', 'auth_info_baileys');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.connectionState = 'disconnected';
    this.qrCodeDataUrl = null;
    this.io = null;
    this.myNumber = null;
    this.historySyncDone = false;
  }

  setIO(io) {
    this.io = io;
  }

  isConnected() {
    return this.connectionState === 'connected' && this.sock !== null;
  }

  async init() {
    try {
      this.connectionState = 'connecting';
      if (this.io) this.io.emit('connection_status', { state: 'connecting' });

      const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const logger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        browser: ['Windows', 'Chrome', '120.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 60000
      });

      this.sock.ev.on('creds.update', saveCreds);

      // ── Connection events ──
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr);
            if (this.io) this.io.emit('qr_code', { qrDataUrl: this.qrCodeDataUrl });
            console.log('New WhatsApp QR code generated.');
          } catch (err) {
            console.error('QR error:', err);
          }
        }

        if (connection === 'close') {
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log('Connection closed error:', lastDisconnect?.error?.message || lastDisconnect?.error, 'statusCode:', lastDisconnect?.error?.output?.statusCode);
          console.log('Connection closed, reconnecting:', shouldReconnect);
          this.connectionState = 'disconnected';
          this.qrCodeDataUrl = null;
          if (this.io) this.io.emit('connection_status', { state: 'disconnected' });

          if (shouldReconnect) {
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => this.init(), 4000);
          } else {
            try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
            setTimeout(() => this.init(), 1000);
          }
        } else if (connection === 'open') {
          console.log('WhatsApp connected!');
          this.connectionState = 'connected';
          this.qrCodeDataUrl = null;
          this.myNumber = this.sock.user?.id ? this.sock.user.id.split(':')[0] : 'Connected';

          if (this.io) {
            this.io.emit('connection_status', {
              state: 'connected',
              myNumber: this.myNumber
            });
          }
        }
      });

      // ── Incoming / outgoing real-time messages ──
      this.sock.ev.on('messages.upsert', async (m) => {
        for (const msg of m.messages) {
          if (!msg.message) continue;
          const jid = msg.key?.remoteJid;
          if (!jid || jid.includes('@g.us') || jid === 'status@broadcast') continue;

          // Normalize phone using LID resolution
          const phone = this.resolvePhoneFromJid(jid);
          if (!phone || phone.length < 10) continue;

          let text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || '';

          const isAudio = !!msg.message.audioMessage;
          const isImage = !!msg.message.imageMessage && !text;
          const isDoc = !!msg.message.documentMessage;

          if (!text.trim()) {
            if (isAudio) {
              text = '[رسالة صوتية]';
            } else if (isImage) {
              text = '[صورة]';
            } else if (isDoc) {
              text = '[ملف / مستند]';
            } else {
              continue;
            }
          }

          console.log(`[Message ${m.type}] fromMe:${msg.key.fromMe} jid:${jid} phone:${phone}: "${text.substring(0, 60)}"`);

          // Ensure contact exists or register as new incoming lead
          const contacts = storage.getContacts();
          let contact = contacts.find(c => {
            const cp = c.phone.replace(/\D/g, '');
            return cp === phone || cp.endsWith(phone) || phone.endsWith(cp);
          });

          let isBrandNewInbound = false;

          if (!contact) {
            const isManualFromMe = !!msg.key.fromMe;
            contact = {
              id: 'cnt_' + Date.now(),
              name: msg.pushName || (isManualFromMe ? `رقم مباشر (${phone.slice(-4)})` : `جهة اتصال جديدة (${phone.slice(-4)})`),
              company: 'واتساب مباشر',
              phone: phone,
              originalPhone: phone,
              notes: isManualFromMe ? 'محادثة يدوية صادرة' : 'تواصل مباشر وارد (غير مدرج بالحملات) - تم إيقاف الرد الآلي تلقائياً لحمايتك',
              status: isManualFromMe ? 'sent' : 'new_inbound',
              sentAt: isManualFromMe ? new Date().toISOString() : null,
              lastReplyAt: isManualFromMe ? null : new Date().toISOString(),
              autoReply: false, // Default FALSE for unknown inbound: bot will NOT auto-reply to strangers!
              isUnsolicited: !isManualFromMe,
              pendingApproval: !isManualFromMe
            };
            contacts.unshift(contact);
            storage.saveContacts(contacts);
            if (!isManualFromMe) isBrandNewInbound = true;
          } else if (!msg.key.fromMe) {
            contact.status = 'replied';
            contact.lastReplyAt = new Date().toISOString();
            storage.saveContacts(contacts);
          }

          // Save message to storage
          const savedMsg = storage.addMessage(phone, {
            fromMe: !!msg.key.fromMe,
            text: text.trim(),
            isAI: false
          });

          // Broadcast to dashboard in real time
          if (this.io && savedMsg) {
            this.io.emit('chat_message', { phone, message: savedMsg });
            this.io.emit('contacts_updated', storage.getContacts());
            if (isBrandNewInbound) {
              this.io.emit('unregistered_contact_inbound', {
                phone: phone,
                name: contact.name,
                text: text.trim(),
                time: new Date().toISOString()
              });
            }
          }

          // AI auto-reply for incoming messages
          const msgTimestamp = Number(msg.messageTimestamp || 0);
          const nowSec = Math.floor(Date.now() / 1000);
          const isRecent = !msgTimestamp || (nowSec - msgTimestamp < 600); // within last 10 minutes

          if (!msg.key.fromMe && isRecent) {
            // Guard: If contact is an unknown stranger pending approval or autoReply is turned off, DO NOT auto-reply!
            if (contact.pendingApproval || contact.isUnsolicited || contact.autoReply === false) {
              console.log(`[Auto-Reply Skipped] Contact ${contact.name} (${phone}) is pending approval or autoReply is disabled.`);
              continue;
            }

            // Check if incoming message is a procurement contact referral
            const referral = this.extractProcurementReferral(text.trim(), phone);
            if (referral) {
              console.log(`[Procurement Referral Triggered] From ${contact.name} (${phone}):`, referral);
              await this.handleProcurementReferral(phone, contact, referral, text.trim());
              continue;
            }

            const settings = storage.getSettings();
            if (settings.autoReplyEnabled && contact.autoReply !== false) {
              this.handleAIAutoReply(phone, text.trim());
            }
          }
        }
      });

    } catch (err) {
      console.error('Init error:', err);
      this.connectionState = 'disconnected';
      if (this.io) this.io.emit('connection_status', { state: 'disconnected', error: err.message });
    }
  }

  broadcastAll() {
    if (this.io) {
      this.io.emit('contacts_updated', storage.getContacts());
      this.io.emit('chats_updated', storage.getChats());
    }
  }

  async handleAIAutoReply(phone, userMessage) {
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const contacts = storage.getContacts();
      const contact = contacts.find((c) => {
        const cp = c.phone.replace(/\D/g, '');
        return cp === cleanPhone || cp.endsWith(cleanPhone) || cleanPhone.endsWith(cp);
      }) || { name: 'عزيزنا العميل', company: '', phone: cleanPhone };

      if (contact.autoReply === false) return;

      // Check if inquiry needs human reply
      if (ai.checkNeedsHuman(userMessage)) {
        contact.needsHumanReply = true;
        contact.unansweredInquiry = userMessage;
        contact.unansweredAt = new Date().toISOString();
        contact.autoReply = false; // Pause AI for this contact so human has full control
        storage.saveContacts(contacts);

        const holdReply = `تمام يا فندم، تم إشعار مسؤول المبيعات فوراً باستفسار حضرتك وهيتواصل مع سيادتك حالاً لمتابعة كافة التفاصيل بدقة. 🌹`;
        await this.sendMessage(cleanPhone, holdReply);
        const savedHold = storage.addMessage(cleanPhone, { fromMe: true, text: holdReply, isAI: true });

        if (this.io) {
          this.io.emit('unanswered_inquiry', {
            phone: cleanPhone,
            name: contact.name,
            text: userMessage,
            time: contact.unansweredAt
          });
          this.io.emit('contacts_updated', storage.getContacts());
          if (savedHold) this.io.emit('chat_message', { phone: cleanPhone, message: savedHold });
        }
        return;
      }

      if (!this.replyDebounceMap) {
        this.replyDebounceMap = new Map();
      }

      if (this.replyDebounceMap.has(cleanPhone)) {
        clearTimeout(this.replyDebounceMap.get(cleanPhone));
      }

      // Natural debounce delay (7-9 seconds) so split-messages are gathered properly
      const typingDelay = Math.floor(Math.random() * 2000) + 7000;

      const timerId = setTimeout(async () => {
        this.replyDebounceMap.delete(cleanPhone);
        try {
          const currentContacts = storage.getContacts();
          const currentContact = currentContacts.find((c) => {
            const cp = c.phone.replace(/\D/g, '');
            return cp === cleanPhone || cp.endsWith(cleanPhone) || cleanPhone.endsWith(cp);
          }) || contact;

          if (currentContact.autoReply === false) return;

          // Combine any recent consecutive unreplied incoming messages
          const chatHistory = storage.getChats(cleanPhone);
          const unrepliedMsgs = [];
          for (let i = chatHistory.length - 1; i >= 0; i--) {
            if (chatHistory[i].fromMe) break;
            unrepliedMsgs.unshift(chatHistory[i].text);
          }
          const combinedUserMessage = unrepliedMsgs.join(' ') || userMessage;

          // 1. Check if client is closed, stopped working, or not buying!
          if (ai.checkIsClosedOrInactive(combinedUserMessage)) {
            currentContact.autoReply = false; // STOP BOT COMPLETELY FOR THIS CONTACT!
            currentContact.notes = (currentContact.notes ? currentContact.notes + ' | ' : '') + 'النشاط متوقف حالياً';
            storage.saveContacts(currentContacts);

            const politeWish = `ربنا ييسر لكم الحال وترجعوا أقوى من الأول وتفتحوا على خير يا رب 🌹 رقمنا مع حضرتك وفي أي وقت تحتاجوا أسعار مصنع لتجهيز الشغل الجديد، نتشرف بخدمتكم دائماً.`;
            await this.sendMessage(cleanPhone, politeWish);
            const savedWish = storage.addMessage(cleanPhone, { fromMe: true, text: politeWish, isAI: true });

            if (this.io) {
              this.io.emit('contacts_updated', storage.getContacts());
              if (savedWish) this.io.emit('chat_message', { phone: cleanPhone, message: savedWish });
            }
            return;
          }

          // 2. Check if client is just sending a closing courtesy/farewell (شكراً، تسلم)
          if (ai.checkIsCourtesyFarewell(combinedUserMessage)) {
            const lastBotMsg = [...chatHistory].reverse().find(m => m.fromMe);
            if (lastBotMsg && (lastBotMsg.text.includes('ترجعوا') || lastBotMsg.text.includes('يومك') || lastBotMsg.text.includes('بالتوفيق') || lastBotMsg.text.includes('شكراً جزيلاً') || lastBotMsg.text.includes('خدمتكم'))) {
              currentContact.autoReply = false; // STOP BOT LOOP!
              storage.saveContacts(currentContacts);

              const farewellReply = `العفو يا فندم، تسلم وتحت أمركم دائماً يا رب 🌹`;
              await this.sendMessage(cleanPhone, farewellReply);
              const savedFarewell = storage.addMessage(cleanPhone, { fromMe: true, text: farewellReply, isAI: true });
              if (this.io) {
                this.io.emit('contacts_updated', storage.getContacts());
                if (savedFarewell) this.io.emit('chat_message', { phone: cleanPhone, message: savedFarewell });
              }
              return;
            }
          }

          const isCatalogReq = ai.checkIsCatalogRequest(combinedUserMessage);

          await this.sendTyping(cleanPhone, 2500);

          const aiReply = await ai.generateReply(currentContact, chatHistory, combinedUserMessage);
          console.log(`[AI Auto-Reply Sent] to ${currentContact.name} (${cleanPhone}): "${aiReply.substring(0, 80)}..."`);

          await this.sendMessage(cleanPhone, aiReply, false);
          const savedMsg = storage.addMessage(cleanPhone, { fromMe: true, text: aiReply, isAI: true });

          await this.sendPaused(cleanPhone);

          if (this.io && savedMsg) {
            this.io.emit('chat_message', { phone: cleanPhone, message: savedMsg });
          }

          // If client asked for catalog or product pictures, send catalog file / link!
          if (isCatalogReq) {
            console.log(`[Catalog Request Detected] Auto-sending catalog to ${cleanPhone}...`);
            await new Promise(r => setTimeout(r, 1200));
            await this.sendCatalog(cleanPhone);
          }
        } catch (e) {
          console.error(`AI auto-reply execution error for ${phone}:`, e.message);
        }
      }, typingDelay);

      this.replyDebounceMap.set(cleanPhone, timerId);
    } catch (err) {
      console.error('handleAIAutoReply error:', err);
    }
  }

  extractProcurementReferral(text, senderPhone) {
    if (!text) return null;
    const easternDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    const norm = text.replace(/[٠-٩]/g, d => easternDigits.indexOf(d));

    // Match potential Egyptian mobile numbers (11 digits starting with 01, or with +20 / 20)
    const matches = norm.match(/(?:(?:\+|00)?20|0)?[\s.-]?1[0125][\d\s.-]{7,12}\d/g);
    if (!matches || matches.length === 0) return null;

    let targetPhone = null;
    const cleanSender = (senderPhone || '').replace(/\D/g, '');
    const myNum = (this.myNumber || '').replace(/\D/g, '');

    for (const m of matches) {
      const digits = m.replace(/\D/g, '');
      let candidate = null;
      if (digits.length === 11 && digits.startsWith('01')) {
        candidate = '2' + digits;
      } else if (digits.length === 10 && digits.startsWith('1')) {
        candidate = '20' + digits;
      } else if (digits.length === 12 && digits.startsWith('201')) {
        candidate = digits;
      }

      if (candidate) {
        // Exclude sender's own number and bot's own number
        const isSender = candidate === cleanSender || cleanSender.endsWith(candidate) || candidate.endsWith(cleanSender);
        const isBot = myNum && (candidate === myNum || myNum.endsWith(candidate) || candidate.endsWith(myNum));
        if (!isSender && !isBot) {
          targetPhone = candidate;
          break;
        }
      }
    }

    if (!targetPhone) return null;

    // Check if message has procurement/referral keywords, OR if last bot message was asking for procurement
    const referralKeywords = [
      'مشتريات', 'المشتريات', 'شراء', 'مسؤول', 'مسئول', 'مدير', 'تواصل', 'كلم',
      'رقم', 'فون', 'واتس', 'اتفضل', 'اتصل', 'باشمهندس', 'استاذ', 'أستاذ', 'مهندس', 'بشمهندس'
    ];
    const hasKeyword = referralKeywords.some(kw => norm.includes(kw));

    // Also check if recent bot message in chat asked about procurement
    let wasAskedAboutProcurement = false;
    const recentChats = storage.getChats(senderPhone);
    if (recentChats && recentChats.length > 0) {
      const lastBotMsg = [...recentChats].reverse().find(m => m.fromMe);
      if (lastBotMsg && (lastBotMsg.text.includes('مشتريات') || lastBotMsg.text.includes('مسؤول') || lastBotMsg.text.includes('مسئول'))) {
        wasAskedAboutProcurement = true;
      }
    }

    if (!hasKeyword && !wasAskedAboutProcurement) {
      return null;
    }

    // Extract person's name if mentioned (e.g. أ. أحمد، مهندس محمود، أستاذ طارق...)
    let detectedName = '';
    const stopWords = ['في', 'بخصوص', 'على', 'عن', 'المشتريات', 'شراء', 'الرقم', 'ده', 'هو', 'هنا', 'الواتس', 'واتساب', 'مسؤول', 'مسئول', 'الشركة', 'مدير'];

    const honorificMatch = norm.match(/(أستاذ|استاذ|أ\.|أ\/|م\.|م\/|مهندس|باشمهندس|بشمهندس|د\.|د\/|دكتور)\s+([\u0621-\u064A]+)(?:\s+([\u0621-\u064A]+))?/i);
    if (honorificMatch) {
      const title = honorificMatch[1];
      const firstWord = honorificMatch[2];
      const secondWord = honorificMatch[3];
      let fullName = title + ' ' + firstWord;
      if (secondWord && !stopWords.includes(secondWord)) {
        fullName += ' ' + secondWord;
      }
      detectedName = fullName.trim();
    } else {
      const directMatch = norm.match(/(?:مع|كلم|تواصل\s+مع)\s+([\u0621-\u064A]+)(?:\s+([\u0621-\u064A]+))?/i);
      if (directMatch) {
        const firstWord = directMatch[1];
        const secondWord = directMatch[2];
        if (!stopWords.includes(firstWord)) {
          let n = firstWord;
          if (secondWord && !stopWords.includes(secondWord)) {
            n += ' ' + secondWord;
          }
          detectedName = n.trim();
        }
      }
    }

    return {
      phone: targetPhone,
      name: detectedName,
      rawText: text
    };
  }

  async handleProcurementReferral(senderPhone, referrerContact, referral, rawText) {
    try {
      const targetPhone = referral.phone;
      const cleanSender = senderPhone.replace(/\D/g, '');
      const company = (referrerContact.company && referrerContact.company !== 'واتساب مباشر' && referrerContact.company !== 'شركتكم الموقرة')
        ? referrerContact.company
        : 'شركتكم الموقرة';

      const detectedPersonName = referral.name ? referral.name : '';
      const leadDisplayName = detectedPersonName || `مسؤول مشتريات (${company})`;

      console.log(`[Procurement Referral] Processing: New Phone ${targetPhone}, Lead: ${leadDisplayName}, Company: ${company}, Referrer: ${referrerContact.name} (${cleanSender})`);

      // 1. Save or update the new procurement contact in storage
      const contacts = storage.getContacts();
      let targetContact = contacts.find(c => {
        const cp = c.phone.replace(/\D/g, '');
        return cp === targetPhone || cp.endsWith(targetPhone) || targetPhone.endsWith(cp);
      });

      if (!targetContact) {
        targetContact = {
          id: 'cnt_' + Date.now(),
          name: leadDisplayName,
          company: company,
          phone: targetPhone,
          originalPhone: targetPhone,
          notes: `مسؤول مشتريات تم تزويدنا برقمه من طرف: ${referrerContact.name || 'عميل'} (${cleanSender})`.trim(),
          status: 'sent',
          sentAt: new Date().toISOString(),
          lastReplyAt: null,
          autoReply: true
        };
        contacts.unshift(targetContact);
      } else {
        if (!targetContact.company || targetContact.company === 'واتساب مباشر' || targetContact.company === 'شركتكم الموقرة') {
          targetContact.company = company;
        }
        if (detectedPersonName && (!targetContact.name || targetContact.name.startsWith('عميل'))) {
          targetContact.name = detectedPersonName;
        }
        targetContact.autoReply = true;
        targetContact.status = 'sent';
        targetContact.sentAt = new Date().toISOString();
        targetContact.notes = (targetContact.notes ? targetContact.notes + ' | ' : '') + `إحالة مشتريات من ${referrerContact.name || ''} (${cleanSender})`;
      }
      storage.saveContacts(contacts);

      // 2. Send thank-you message to the referrer
      const thankYouMsg = `شكراً جزيلاً لذوقك وتعاونك يا فندم 🌹 تم تدوين بيانات مسؤول المشتريات والتواصل معه حالاً. يومكم سعيد!`;

      await this.sendMessage(cleanSender, thankYouMsg);
      const savedReferrerMsg = storage.addMessage(cleanSender, {
        fromMe: true,
        text: thankYouMsg,
        isAI: true
      });

      if (this.io && savedReferrerMsg) {
        this.io.emit('chat_message', { phone: cleanSender, message: savedReferrerMsg });
      }

      // 3. Natural delay before messaging the new procurement contact (1.5s)
      await new Promise(r => setTimeout(r, 1500));

      // 4. Send Cold B2B Outreach Message to the new procurement contact
      const outreachGreeting = 'فندم';
      const outreachMessage = `السلام عليكم يا فندم، تحياتنا لحضرتك ولفريق ${company} 🌹\nمعاك حكيم جروب لمواد التعبئة والتغليف (مصنعنا بالعاشر من رمضان).\nتم تزويدنا برقم حضرتك من طرف إدارة المنشأة بخصوص احتياجات التعبئة والتغليف، وكنا حابين نعرف إيه أصناف ومقاسات العلب أو الأكواب اللي بتسحبوها عادة نقدر نخدم حضراتكم فيها مباشرة من المصنع؟`;

      await this.sendMessage(targetPhone, outreachMessage);
      const savedTargetMsg = storage.addMessage(targetPhone, {
        fromMe: true,
        text: outreachMessage,
        isAI: true
      });

      // 5. Broadcast real-time updates to dashboard
      if (this.io) {
        this.io.emit('contacts_updated', storage.getContacts());
        if (savedTargetMsg) {
          this.io.emit('chat_message', { phone: targetPhone, message: savedTargetMsg });
        }
        this.io.emit('procurement_lead_created', {
          referrer: referrerContact,
          lead: targetContact,
          targetPhone: targetPhone,
          company: company
        });
      }

      console.log(`[Procurement Referral Completed] Successfully routed to ${targetPhone} for company "${company}"`);
    } catch (err) {
      console.error('handleProcurementReferral error:', err);
    }
  }

  resolvePhoneFromJid(jid) {
    if (!jid) return null;
    let clean = jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/:\d+/, '').replace(/\D/g, '');
    if (jid.endsWith('@lid') || clean.length > 12) {
      try {
        const reverseFile = path.join(SESSION_DIR, `lid-mapping-${clean}_reverse.json`);
        if (fs.existsSync(reverseFile)) {
          const mapped = JSON.parse(fs.readFileSync(reverseFile, 'utf8'));
          if (mapped) {
            let num = String(mapped).replace(/\D/g, '');
            if (num.startsWith('01') && num.length === 11) num = '2' + num;
            return num;
          }
        }
      } catch (e) {}

      // Check contacts in storage
      const contacts = storage.getContacts();
      const match = contacts.find(c => c.phone.includes(clean) || (c.notes && c.notes.includes(clean)));
      if (match) return match.phone.replace(/\D/g, '');
    }

    if (clean.startsWith('01') && clean.length === 11) {
      clean = '2' + clean;
    }
    return clean;
  }

  async checkOnWhatsApp(phone) {
    if (!this.isConnected() || !this.sock) return null;
    let clean = phone.replace(/\D/g, '');
    if (clean.startsWith('01') && clean.length === 11) clean = '2' + clean;
    if (clean.length < 9) return false;
    try {
      const results = await this.sock.onWhatsApp(clean);
      if (!results || results.length === 0 || !results[0].exists) {
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`checkOnWhatsApp check error for ${clean}:`, e.message);
      return null;
    }
  }

  async sendTyping(cleanPhone, durationMs = 3000) {
    if (!this.isConnected()) return;
    const jid = `${cleanPhone}@s.whatsapp.net`;
    try {
      await this.sock.presenceSubscribe(jid);
      await this.sock.sendPresenceUpdate('composing', jid);
      if (durationMs > 0) {
        await new Promise(r => setTimeout(r, durationMs));
      }
    } catch (e) {}
  }

  async sendPaused(cleanPhone) {
    if (!this.isConnected()) return;
    const jid = `${cleanPhone}@s.whatsapp.net`;
    try {
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch (e) {}
  }

  async sendMessage(phone, text, simulateTyping = true) {
    if (!this.isConnected()) throw new Error('WhatsApp is not connected');
    let clean = phone.replace(/\D/g, '');

    if (clean.startsWith('01') && clean.length === 11) {
      clean = '2' + clean;
    }

    if (clean.length > 12) {
      const resolved = this.resolvePhoneFromJid(`${clean}@lid`);
      if (resolved && resolved !== clean) {
        clean = resolved;
      }
    }

    const jid = `${clean}@s.whatsapp.net`;
    if (simulateTyping) {
      try {
        // 1. Mark presence as available (Human online presence)
        await this.sock.sendPresenceUpdate('available');
        await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));

        // 2. Realistic human typing simulation (40-60ms per character, min 4s, max 12s)
        const charCount = (text || '').length;
        const typingDuration = Math.min(12000, Math.max(4000, charCount * 45 + Math.floor(Math.random() * 2000)));
        await this.sendTyping(clean, typingDuration);

        // 3. Human reading pause before pressing send
        await this.sendPaused(clean);
        await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));
      } catch (e) {}
    }

    const res = await this.sock.sendMessage(jid, { text });

    if (simulateTyping) {
      try {
        await new Promise(r => setTimeout(r, 1200 + Math.floor(Math.random() * 1200)));
        await this.sock.sendPresenceUpdate('unavailable');
      } catch (e) {}
    }
    return res;
  }

  async sendCatalog(phone, customCaption = null) {
    if (!this.isConnected()) throw new Error('WhatsApp is not connected');
    let clean = this.resolvePhoneFromJid(phone) || phone.replace(/\D/g, '');
    if (clean.startsWith('01') && clean.length === 11) clean = '2' + clean;
    const jid = `${clean}@s.whatsapp.net`;

    const settings = storage.getSettings();
    let pdfSent = false;
    const uploadsPdf = path.join(__dirname, '..', 'data', 'uploads', 'catalog.pdf');
    const customPdf = settings.catalogPdfPath ? path.resolve(__dirname, '..', settings.catalogPdfPath) : null;
    const targetPdf = (customPdf && fs.existsSync(customPdf)) ? customPdf : (fs.existsSync(uploadsPdf) ? uploadsPdf : null);

    const mode = settings.catalogMode || 'both';

    const websiteLink = settings.catalogLink || 'https://hakim-chi.vercel.app/products';

    if (targetPdf && (mode === 'pdf_preferred' || mode === 'both')) {
      try {
        console.log(`[sendCatalog] Sending PDF to ${clean}... (File: ${targetPdf}, Size: ${(fs.statSync(targetPdf).size / 1024 / 1024).toFixed(2)} MB)`);
        await this.sendTyping(clean, 1500);
        const caption = customCaption || `كتالوج منتجات التعبئة والتغليف - مصانع حكيم جروب بالعاشر من رمضان 🌹\nمرفق لسيادتكم كافة الأصناف والمقاسات والأقطار المتاحة، ويمكنكم أيضاً تصفح المنتجات أونلاين عبر:\n${websiteLink}`;
        const buffer = fs.readFileSync(targetPdf);
        const sentDoc = await this.sock.sendMessage(jid, {
          document: buffer,
          mimetype: 'application/pdf',
          fileName: 'كتالوج_حكيم_جروب_لمواد_التعبئة_والتغليف.pdf',
          caption: caption
        }, { mediaUploadTimeoutMs: 180000 });
        console.log(`[sendCatalog] PDF sent successfully to ${clean}! Message ID: ${sentDoc?.key?.id}`);
        await this.sendPaused(clean);
        pdfSent = true;

        const savedPdf = storage.addMessage(clean, {
          fromMe: true,
          text: `[ملف PDF تم إرساله]: كتالوج_حكيم_جروب_لمواد_التعبئة_والتغليف.pdf\n${caption}`,
          isAI: true
        });
        if (this.io && savedPdf) {
          this.io.emit('chat_message', { phone: clean, message: savedPdf });
        }
      } catch (err) {
        console.error('Failed to send catalog PDF:', err);
      }
    }

    if (!pdfSent || mode === 'both' || mode === 'link_only') {
      await this.sendTyping(clean, 2000);
      const linkMsg = `اتفضل يا فندم، ده رابط تصفح كتالوج منتجات مصانع حكيم جروب للتعبئة والتغليف:\n${websiteLink}\nيشرفنا تصفح حضرتك ونحن جاهزون لتوفير كافة متطلبات نشاطك. 🌹`;
      await this.sock.sendMessage(jid, { text: linkMsg });
      await this.sendPaused(clean);
      const savedLink = storage.addMessage(clean, { fromMe: true, text: linkMsg, isAI: true });
      if (this.io && savedLink) {
        this.io.emit('chat_message', { phone: clean, message: savedLink });
      }
    }
  }

  async logout() {
    try { if (this.sock) await this.sock.logout(); } catch (e) {}
    this.connectionState = 'disconnected';
    this.qrCodeDataUrl = null;
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
    if (this.io) this.io.emit('connection_status', { state: 'disconnected' });
  }
}

module.exports = new WhatsAppService();
