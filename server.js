require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const storage = require('./src/storage');
const ai = require('./src/ai');
const whatsappService = require('./src/whatsapp');
const campaignManager = require('./src/campaign');
const leadFinder = require('./src/leadFinder');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3050;

app.use(cors());
app.use(express.json());
// Prevent aggressive browser caching during development
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Favicon handler to prevent 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Set up upload folder for Excel files
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOADS_DIR });

// Link services with Socket.io
whatsappService.setIO(io);
campaignManager.setDependencies(io, whatsappService);
leadFinder.setWhatsAppService(whatsappService);

// ---------------- REST API ROUTES ----------------

// Status
app.get('/api/status', (req, res) => {
  res.json({
    whatsapp: {
      connected: whatsappService.isConnected(),
      state: whatsappService.connectionState,
      myNumber: whatsappService.myNumber,
      qrCode: whatsappService.qrCodeDataUrl
    },
    campaign: campaignManager.getStatusSummary()
  });
});

// Download full packaging catalog Excel
app.get('/api/download/catalog-excel', (req, res) => {
  const filePath = path.join(__dirname, 'قائمة_منتجات_التعبئة_والتغليف_والكرتون.xlsx');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'قائمة_منتجات_التعبئة_والتغليف_والكرتون.xlsx');
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// Download empty client template Excel
app.get('/api/download/template-empty', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'template_empty.xlsx');
  if (fs.existsSync(filePath)) {
    const filename = encodeURIComponent('قالب_عملاء_حكيم_جروب_فارغ.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// Download populated Ramadan & Ismailia sample Excel
app.get('/api/download/sample-ramadan-ismailia', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'sample_ramadan_ismailia.xlsx');
  if (fs.existsSync(filePath)) {
    const filename = encodeURIComponent('بيانات_عملاء_العاشر_من_رمضان_والإسماعيلية.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// Download Sushi restaurants Excel for 10th of Ramadan & Ismailia
app.get('/api/download/sushi-excel', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'مطاعم_السوشي_العاشر_والإسماعيلية.xlsx');
  if (fs.existsSync(filePath)) {
    const filename = encodeURIComponent('مطاعم_السوشي_العاشر_والإسماعيلية.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// Download All-Egypt Verified Contacts Excel
app.get('/api/download/all-egypt-verified', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'عملاء_محافظات_مصر_مؤكد_واتساب.xlsx');
  if (fs.existsSync(filePath)) {
    const filename = encodeURIComponent('عملاء_محافظات_مصر_مؤكد_واتساب.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.status(404).send('الملف غير موجود');
  }
});

// Direct load All-Egypt Verified clients into campaign
app.post('/api/contacts/load-all-egypt-verified', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'data', 'عملاء_محافظات_مصر_مؤكد_واتساب.xlsx');
    const contacts = campaignManager.parseExcel(filePath);
    io.emit('contacts_updated', contacts);
    res.json({
      success: true,
      message: `تم تحميل ${contacts.length} عميل حقيقي من محافظات مصر (مؤكدين واتساب) بنجاح!`,
      count: contacts.length,
      contacts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Direct load Ramadan & Ismailia clients into campaign
app.post('/api/contacts/load-ramadan-sample', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'data', 'sample_ramadan_ismailia.xlsx');
    const contacts = campaignManager.parseExcel(filePath);
    io.emit('contacts_updated', contacts);
    res.json({
      success: true,
      message: `تم تحميل ${contacts.length} عميل من العاشر من رمضان والإسماعيلية بنجاح!`,
      count: contacts.length,
      contacts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WhatsApp Actions
app.post('/api/whatsapp/connect', async (req, res) => {
  try {
    if (!whatsappService.isConnected()) {
      await whatsappService.init();
    }
    res.json({ success: true, message: 'جاري تهيئة اتصال الواتساب...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    await whatsappService.logout();
    res.json({ success: true, message: 'تم تسجيل الخروج بنجاح.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Settings & Knowledge
app.get('/api/settings', (req, res) => {
  res.json(storage.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = storage.saveSettings(req.body);
  res.json({ success: true, data: updated });
});

app.get('/api/knowledge', (req, res) => {
  res.json(storage.getKnowledge());
});

app.post('/api/knowledge', (req, res) => {
  const updated = storage.saveKnowledge(req.body);
  res.json({ success: true, data: updated });
});

// Test AI Response
app.post('/api/test-ai', async (req, res) => {
  try {
    const { message, contactName, companyName } = req.body;
    const contact = {
      name: contactName || 'أحمد التجريبي',
      company: companyName || 'ورشة الإخلاص للألومنيوم',
      phone: '01000000000'
    };
    const reply = await ai.generateReply(contact, [], message || 'السلام عليكم، بتبيعوا قطاعات إيه؟');
    res.json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify phone numbers on WhatsApp
app.post('/api/whatsapp/verify-numbers', async (req, res) => {
  try {
    const { numbers } = req.body || {};
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ success: false, error: 'أرسل مصفوفة أرقام للتحقق.' });
    }
    if (!whatsappService.isConnected()) {
      return res.status(503).json({ success: false, error: 'الواتساب غير متصل.' });
    }
    const verified = [];
    for (const num of numbers) {
      let clean = String(num).replace(/\D/g, '');
      if (clean.startsWith('01') && clean.length === 11) clean = '2' + clean;
      const onWA = await whatsappService.checkOnWhatsApp(clean);
      verified.push({ phone: clean, onWhatsApp: onWA === true });
    }
    res.json({ success: true, results: verified });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Contacts & Excel Upload
app.get('/api/contacts', (req, res) => {
  res.json(storage.getContacts());
});

app.post('/api/contacts/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم اختيار أي ملف.' });
    }
    const contacts = campaignManager.parseExcel(req.file.path);
    io.emit('contacts_updated', contacts);
    res.json({
      success: true,
      message: `تم استيراد ${contacts.length} جهة اتصال بنجاح!`,
      count: contacts.length,
      contacts
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/contacts/clear', (req, res) => {
  storage.saveContacts([]);
  io.emit('contacts_updated', []);
  res.json({ success: true, message: 'تم مسح قائمة جهات الاتصال.' });
});

// Delete a single contact
app.delete('/api/contacts/:phone', (req, res) => {
  try {
    const phone = req.params.phone;
    const deleted = storage.deleteContact(phone);
    if (deleted) {
      io.emit('contacts_updated', storage.getContacts());
      return res.json({ success: true, message: 'تم حذف الرقم بنجاح.' });
    }
    return res.status(404).json({ success: false, error: 'الرقم غير موجود.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sanitize all contacts: remove person names, enforce 'يا فندم', filter test numbers
app.post('/api/contacts/sanitize-names', (req, res) => {
  try {
    let contacts = storage.getContacts();
    contacts = contacts.filter(c => {
      const p = (c.phone || '').replace(/\D/g, '');
      if (p.length < 8 || p === '74844133687473' || p === '201129105505') return false;
      return true;
    });
    contacts.forEach(c => {
      c.name = 'يا فندم';
    });
    storage.saveContacts(contacts);
    io.emit('contacts_updated', contacts);
    res.json({ success: true, count: contacts.length, message: 'تم تنظيف كافة الأسماء واعتماد "يا فندم" وحذف الأرقام التجريبية بنجاح.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear failed / invalid contacts from campaign
app.post('/api/contacts/clear-failed', (req, res) => {
  try {
    let contacts = storage.getContacts();
    const initialCount = contacts.length;
    contacts = contacts.filter(c => c.status !== 'failed');
    storage.saveContacts(contacts);
    io.emit('contacts_updated', contacts);
    res.json({
      success: true,
      removed: initialCount - contacts.length,
      remaining: contacts.length,
      message: `تم حذف ${initialCount - contacts.length} رقم غير مسجل على واتساب بنجاح.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get past days archived contacts
app.get('/api/contacts/archive', (req, res) => {
  try {
    const archive = storage.getArchiveContacts();
    res.json({ success: true, count: archive.length, archive });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run archive past days manually
app.post('/api/contacts/archive/run', (req, res) => {
  try {
    const result = storage.archivePastDaysContacts();
    io.emit('contacts_updated', storage.getContacts());
    res.json({ success: true, ...result, message: `تم ترحيل ${result.movedCount} جهة اتصال سابقة للأرشيف. قائمة اليوم تبدأ من 1 بإجمالي ${result.todayCount} عميل.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restore contact from archive to today's campaign
app.post('/api/contacts/archive/restore', (req, res) => {
  try {
    const { phone } = req.body;
    const restored = storage.restoreContactFromArchive(phone);
    if (restored) {
      io.emit('contacts_updated', storage.getContacts());
      return res.json({ success: true, restored, message: 'تمت إعادة جهة الاتصال لحملة اليوم بنجاح.' });
    }
    return res.status(404).json({ success: false, error: 'الرقم غير موجود بالأرشيف.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export archive to Excel
app.get('/api/contacts/archive/export-excel', (req, res) => {
  try {
    const archive = storage.getArchiveContacts();
    const rows = archive.map((c, idx) => ({
      'م': idx + 1,
      'الاسم': c.name || 'يا فندم',
      'الشركة / المنشأة': c.company || '',
      'رقم الواتساب': c.phone,
      'المحافظة / المدينة': (c.city || c.governorate || ''),
      'تاريخ المراسلة': c.sentDate || (c.sentAt ? new Date(c.sentAt).toLocaleDateString('ar-EG') : 'أيام سابقة'),
      'عدد الرسائل': c.messagesCount || 1,
      'آخر رسالة': c.lastMessage || '',
      'الحالة': c.status === 'replied' ? 'رد على الرسالة' : 'تم الإرسال'
    }));

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'أرشيف الأيام السابقة');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = encodeURIComponent('أرشيف_حملات_الأيام_السابقة.xlsx');
    res.setHeader('Content-Disposition', `attachment=\"${filename}\"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add Single Contact Manually (Name & Company optional)
app.post('/api/contacts/add-single', (req, res) => {
  try {
    let { phone, name, company, city, activity, notes } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف إلزامي.' });
    }

    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.startsWith('01') && cleanPhone.length === 11) {
      cleanPhone = '2' + cleanPhone;
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف غير صالح. يجب أن يحتوي على 10 أرقام على الأقل.' });
    }

    const contacts = storage.getContacts();
    let contactName = (name && name.trim()) ? name.trim() : 'يا فندم';
    let companyName = (company && company.trim()) ? company.trim() : 'شركتكم الموقرة';

    const noteParts = [];
    if (city && city.trim()) noteParts.push(`المدينة: ${city.trim()}`);
    if (activity && activity.trim()) noteParts.push(`النشاط: ${activity.trim()}`);
    if (notes && notes.trim()) noteParts.push(notes.trim());
    const finalNotes = noteParts.join(' | ');

    const existingIdx = contacts.findIndex(c => c.phone.replace(/\D/g, '') === cleanPhone);
    let newContact;

    if (existingIdx !== -1) {
      if (name && name.trim()) contacts[existingIdx].name = contactName;
      if (company && company.trim()) contacts[existingIdx].company = companyName;
      if (finalNotes) contacts[existingIdx].notes = finalNotes;
      newContact = contacts[existingIdx];
    } else {
      newContact = {
        id: 'cnt_' + Date.now(),
        name: contactName,
        company: companyName,
        phone: cleanPhone,
        originalPhone: phone,
        notes: finalNotes,
        status: 'pending',
        sentAt: null,
        lastError: null,
        autoReply: true
      };
      contacts.unshift(newContact);
    }

    storage.saveContacts(contacts);
    io.emit('contacts_updated', contacts);

    res.json({
      success: true,
      contact: newContact,
      message: `تمت إضافة العميل (${newContact.name}) بنجاح!`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Campaign Controls
app.post('/api/campaign/start', async (req, res) => {
  try {
    await campaignManager.start();
    res.json({ success: true, message: 'تم بدء الحملة بنجاح.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/campaign/pause', (req, res) => {
  campaignManager.pause();
  res.json({ success: true, message: 'تم إيقاف الحملة مؤقتاً.' });
});

app.post('/api/campaign/reset', (req, res) => {
  campaignManager.reset();
  res.json({ success: true, message: 'تمت إعادة ضبط الحملة.' });
});

// Chats & Manual Sending
app.get('/api/chats', (req, res) => {
  res.json(storage.getChats());
});

app.get('/api/chats/:phone', (req, res) => {
  res.json(storage.getChats(req.params.phone));
});

// AI Follow-up: Read old chat or start fresh
app.post('/api/contacts/:phone/ai-followup', async (req, res) => {
  try {
    const rawPhone = req.params.phone;
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const contacts = storage.getContacts();
    let contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone);

    if (!contact) {
      contact = {
        name: 'يا فندم',
        company: 'شركتكم الموقرة',
        phone: cleanPhone,
        notes: ''
      };
    }

    const chats = storage.getChats(cleanPhone) || [];
    const hasHistory = Array.isArray(chats) && chats.length > 0;
    const generatedText = await ai.generateFollowupMessage(contact, chats);

    const { sendImmediately } = req.body || {};

    if (sendImmediately) {
      await whatsappService.sendMessage(cleanPhone, generatedText);
      const savedMsg = storage.addMessage(cleanPhone, {
        fromMe: true,
        text: generatedText,
        isAI: true
      });
      io.emit('chat_message', { phone: cleanPhone, message: savedMsg });
      contact.autoReply = true;
      if (contact.status === 'pending') {
        contact.status = 'sent';
        contact.sentAt = new Date().toISOString();
      }
      storage.updateContactStatus(cleanPhone, contact.status, { sentAt: contact.sentAt, autoReply: true });
      io.emit('contacts_updated', storage.getContacts());
      return res.json({
        success: true,
        text: generatedText,
        sent: true,
        hasHistory,
        historyCount: chats.length,
        message: savedMsg
      });
    }

    res.json({
      success: true,
      text: generatedText,
      sent: false,
      hasHistory,
      historyCount: chats.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chats/:phone/send', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'نص الرسالة فارغ.' });
    }
    const phone = req.params.phone;
    await whatsappService.sendMessage(phone, text);

    const savedMsg = storage.addMessage(phone, {
      fromMe: true,
      text: text.trim(),
      isAI: false
    });

    // Auto resolve pending inquiry if human replied
    const cleanPhone = phone.replace(/\D/g, '');
    const contacts = storage.getContacts();
    const contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
    if (contact && contact.needsHumanReply) {
      contact.needsHumanReply = false;
      contact.unansweredInquiry = null;
      contact.unansweredAt = null;
      storage.saveContacts(contacts);
      io.emit('contacts_updated', contacts);
    }

    io.emit('chat_message', { phone, message: savedMsg });
    res.json({ success: true, message: savedMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle Auto-Reply globally
app.post('/api/settings/toggle-autoreply', (req, res) => {
  const settings = storage.getSettings();
  const { enabled } = req.body || {};
  settings.autoReplyEnabled = (typeof enabled === 'boolean') ? enabled : !settings.autoReplyEnabled;
  storage.saveSettings(settings);
  io.emit('settings_updated', settings);
  res.json({ success: true, autoReplyEnabled: settings.autoReplyEnabled });
});

// Toggle Auto-Reply per contact
app.post('/api/contacts/:phone/toggle-autoreply', (req, res) => {
  const cleanPhone = req.params.phone.replace(/\D/g, '');
  const contacts = storage.getContacts();
  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
  if (!contact) return res.status(404).json({ success: false, error: 'العميل غير موجود' });

  const { enabled } = req.body || {};
  contact.autoReply = (typeof enabled === 'boolean') ? enabled : !contact.autoReply;
  storage.saveContacts(contacts);
  io.emit('contacts_updated', contacts);
  res.json({ success: true, autoReply: contact.autoReply });
});

// Resolve unanswered inquiry
app.post('/api/contacts/:phone/resolve-inquiry', (req, res) => {
  const cleanPhone = req.params.phone.replace(/\D/g, '');
  const contacts = storage.getContacts();
  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
  if (contact) {
    contact.needsHumanReply = false;
    contact.unansweredInquiry = null;
    contact.unansweredAt = null;
    storage.saveContacts(contacts);
    io.emit('contacts_updated', contacts);
  }
  res.json({ success: true });
});

// Branches management
app.get('/api/branches', (req, res) => {
  const knowledge = storage.getKnowledge();
  res.json({ success: true, branches: knowledge.branches || [] });
});

app.post('/api/branches', (req, res) => {
  const { branches } = req.body || {};
  const knowledge = storage.getKnowledge();
  knowledge.branches = branches || [];
  storage.saveKnowledge(knowledge);
  io.emit('branches_updated', knowledge.branches);
  res.json({ success: true, count: knowledge.branches.length, branches: knowledge.branches });
});

app.post('/api/branches/add', (req, res) => {
  try {
    const { id, name, city, governorate, servedAreas, address, mapLink, phone, notes } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم المعرض أو الفرع إلزامي.' });
    }
    const knowledge = storage.getKnowledge();
    const branches = knowledge.branches || [];
    const branchId = id || ('br_' + Date.now());

    const branchObj = {
      id: branchId,
      name: name.trim(),
      city: (city || '').trim(),
      governorate: (governorate || '').trim(),
      servedAreas: (servedAreas || '').trim(),
      address: (address || '').trim(),
      mapLink: (mapLink || '').trim(),
      phone: (phone || '').trim(),
      notes: (notes || '').trim()
    };

    const existingIdx = branches.findIndex(b => b.id === branchId);
    if (existingIdx !== -1) {
      branches[existingIdx] = branchObj;
    } else {
      branches.push(branchObj);
    }

    knowledge.branches = branches;
    storage.saveKnowledge(knowledge);
    io.emit('branches_updated', branches);
    res.json({ success: true, branch: branchObj, branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/branches/:id', (req, res) => {
  try {
    const id = req.params.id;
    const knowledge = storage.getKnowledge();
    knowledge.branches = (knowledge.branches || []).filter(b => b.id !== id);
    storage.saveKnowledge(knowledge);
    io.emit('branches_updated', knowledge.branches);
    res.json({ success: true, branches: knowledge.branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/branches/test-recommendation', async (req, res) => {
  try {
    const { text } = req.body || {};
    const knowledge = storage.getKnowledge();
    const branches = knowledge.branches || [];
    const query = (text || 'أنا من المنصورة في فرع عندكم؟').trim();
    const closest = ai.findClosestBranch(query, branches);
    const testContact = { name: 'أحمد التجريبي', phone: '01000000000' };
    const simulatedReply = await ai.generateReply(testContact, [], query);
    res.json({
      success: true,
      query,
      closestBranch: closest,
      reply: simulatedReply,
      simulatedReply
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Catalog PDF & Link Management ──
app.post('/api/catalog/upload-pdf', upload.single('catalogFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'لم يتم اختيار أي ملف PDF.' });
    }
    const targetPath = path.join(UPLOADS_DIR, 'catalog.pdf');
    fs.copyFileSync(req.file.path, targetPath);
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    const settings = storage.getSettings();
    settings.catalogPdfPath = 'data/uploads/catalog.pdf';
    storage.saveSettings(settings);

    res.json({
      success: true,
      message: 'تم رفع وتحديث كتالوج الـ PDF بنجاح! سيتم إرساله للعملاء عند الطلب.',
      path: 'data/uploads/catalog.pdf'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/catalog/status', (req, res) => {
  const targetPath = path.join(UPLOADS_DIR, 'catalog.pdf');
  const exists = fs.existsSync(targetPath);
  let sizeMb = null;
  let modifiedAt = null;
  if (exists) {
    const stat = fs.statSync(targetPath);
    sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
    modifiedAt = stat.mtime.toISOString();
  }
  const settings = storage.getSettings();
  res.json({
    hasPdf: exists,
    sizeMb,
    modifiedAt,
    catalogLink: settings.catalogLink || 'https://hakim-chi.vercel.app/products',
    catalogMode: settings.catalogMode || 'pdf_preferred'
  });
});

app.post('/api/chats/:phone/send-catalog', async (req, res) => {
  try {
    const phone = req.params.phone;
    await whatsappService.sendCatalog(phone);
    res.json({ success: true, message: 'تم إرسال الكتالوج للعميل بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve auto-reply for unregistered contact
app.post('/api/contacts/:phone/approve-autoreply', (req, res) => {
  const cleanPhone = req.params.phone.replace(/\D/g, '');
  const contacts = storage.getContacts();
  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
  if (!contact) return res.status(404).json({ success: false, error: 'الرقم غير موجود' });

  contact.autoReply = true;
  contact.pendingApproval = false;
  contact.isUnsolicited = false;
  storage.saveContacts(contacts);
  io.emit('contacts_updated', contacts);
  res.json({ success: true, message: `تم تفعيل الرد الآلي للرقم (${contact.phone}) بنجاح!` });
});

// Export all contacts to Excel for safekeeping and retargeting
app.get('/api/contacts/export-excel', (req, res) => {
  try {
    const xlsx = require('xlsx');
    const contacts = storage.getContacts();
    const rows = contacts.map((c, i) => ({
      'م': i + 1,
      'الاسم': c.name || '',
      'الشركة': c.company || '',
      'رقم الهاتف': c.phone || '',
      'الحالة': c.status === 'replied' ? 'تم الرد' : (c.status === 'sent' ? 'تم الإرسال' : (c.status === 'new_inbound' ? 'تواصل جديد' : 'معلق')),
      'الرد التلقائي': c.autoReply ? 'شغال' : 'متوقف',
      'تاريخ الإرسال': c.sentAt ? new Date(c.sentAt).toLocaleString('ar-EG') : '',
      'تاريخ آخر رد': c.lastReplyAt ? new Date(c.lastReplyAt).toLocaleString('ar-EG') : '',
      'ملاحظات': c.notes || ''
    }));

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'جهات الاتصال');

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = encodeURIComponent('جهات_اتصال_حكيم_جروب_المسجلة.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- AI LEAD FINDER & RE-ENGAGEMENT ROUTES ----------------

// 1. Search & Generate Leads with Deduplication
app.post('/api/leads/find', async (req, res) => {
  try {
    const { governorates, category, count, isRandom, allowDuplicates } = req.body || {};
    const result = await leadFinder.findLeads({
      governorates: governorates || [],
      category: category || 'all',
      count: parseInt(count, 10) || 50,
      isRandom: Boolean(isRandom),
      allowDuplicates: Boolean(allowDuplicates)
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Download extracted leads as Excel
app.post('/api/leads/export-excel', (req, res) => {
  try {
    const { leads } = req.body || {};
    const list = (Array.isArray(leads) && leads.length > 0) ? leads : leadFinder.leadsCache;
    if (!list || list.length === 0) {
      return res.status(400).json({ success: false, error: 'لا توجد بيانات عملاء لتصديرها.' });
    }
    const buffer = leadFinder.exportLeadsToExcel(list);
    const filename = encodeURIComponent('قائمة_عملاء_حكيم_جروب_الجديدة.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Import fresh leads directly into campaign
app.post('/api/leads/import-to-campaign', (req, res) => {
  try {
    const { leads } = req.body || {};
    const list = (Array.isArray(leads) && leads.length > 0) ? leads : leadFinder.leadsCache;
    if (!list || list.length === 0) {
      return res.status(400).json({ success: false, error: 'لا توجد بيانات لإضافتها للحملة.' });
    }
    const result = leadFinder.importLeadsToCampaign(list);
    io.emit('contacts_updated', storage.getContacts());
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Get 14-day re-engagement candidates
app.get('/api/leads/followup-14days', (req, res) => {
  try {
    const candidates = leadFinder.get14DayFollowupLeads();
    res.json({ success: true, count: candidates.length, candidates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Send 14-day friendly reminder message
app.post('/api/leads/send-14day-followup', async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    if (!phone) {
      return res.status(400).json({ success: false, error: 'رقم الهاتف مطلوب.' });
    }
    const clean = phone.replace(/\D/g, '');
    const textToSend = (message || '').trim() || 'أهلاً بحضرتك يا فندم، بنتابع مع سيادتك ونحب نطمن لو محتاجين أي أصناف أو مقاسات من عبوات ومستلزمات التعبئة والتغليف الفترة دي، وتحت أمركم في أي وقت 🌹';
    
    await whatsappService.sendMessage(clean, textToSend);

    // Save message in chats
    const chats = storage.getChats();
    if (!chats[clean]) chats[clean] = [];
    chats[clean].push({
      id: 'msg_' + Date.now(),
      fromMe: true,
      text: textToSend,
      timestamp: new Date().toISOString(),
      type: 'followup_14days'
    });
    storage.saveChats(chats);

    // Update contact
    const contacts = storage.getContacts();
    const idx = contacts.findIndex(c => c.phone.replace(/\D/g, '') === clean);
    if (idx !== -1) {
      contacts[idx].lastSentAt = new Date().toISOString();
      contacts[idx].followup14SentAt = new Date().toISOString();
      storage.saveContacts(contacts);
      io.emit('contacts_updated', contacts);
    }
    io.emit('chats_updated', chats);

    res.json({ success: true, message: 'تم إرسال رسالة المتابعة بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- SOCKET.IO REALTIME ----------------
io.on('connection', (socket) => {
  console.log('Client connected to dashboard UI.');

  // Send current state immediately on connect
  socket.emit('connection_status', {
    state: whatsappService.connectionState,
    myNumber: whatsappService.myNumber,
    qrDataUrl: whatsappService.qrCodeDataUrl
  });

  socket.emit('campaign_status', campaignManager.getStatusSummary());
});

// ---------------- START SERVER ----------------
server.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 WhatsApp AI Outreach Agent running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`=======================================================`);

  // Auto initialize WhatsApp client on server start
  whatsappService.init();
});
