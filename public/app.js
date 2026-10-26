// Socket.io initialization
const socket = io();

// State variables
let currentTab = 'tab-campaign';
let contacts = [];
let chats = {};
let activeChatPhone = null;
let settings = {};
let knowledge = {};
let branches = [];
let connectionState = 'disconnected';

// ---------------- TAB NAVIGATION ----------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  const targetBtn = document.getElementById('btn-' + tabId);

  if (targetTab) targetTab.classList.remove('hidden');
  if (targetBtn) targetBtn.classList.add('active');

  currentTab = tabId;

  // Refresh inbox if switching to inbox
  if (tabId === 'tab-inbox') {
    loadChats();
    renderChatsSidebar();
    if (activeChatPhone) renderActiveChatMessages();
  } else if (tabId === 'tab-branches') {
    loadBranches();
  } else if (tabId === 'tab-leads') {
    initLeadsTab();
  }
}

// ---------------- INITIAL FETCH ----------------
async function initApp() {
  await loadStatus();
  await loadSettings();
  await loadKnowledge();
  await loadBranches();
  await loadContacts();
  await loadArchiveContacts();
  await loadChats();
  await loadCatalogStatus();
  setupDropzone();
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateConnectionUI(data.whatsapp);
    updateCampaignUI(data.campaign);
  } catch (e) {
    console.error('Error loading status:', e);
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    settings = await res.json();

    document.getElementById('ai-provider').value = settings.provider || 'gemini';
    document.getElementById('ai-model').value = settings.model || 'gemini-3.5-flash-lite';
    document.getElementById('ai-api-key').value = settings.apiKey || '';
    if (document.getElementById('min-delay')) document.getElementById('min-delay').value = settings.minDelaySeconds || 60;
    if (document.getElementById('max-delay')) document.getElementById('max-delay').value = settings.maxDelaySeconds || 180;
    if (document.getElementById('batch-size')) document.getElementById('batch-size').value = settings.batchSize || 5;
    if (document.getElementById('batch-cooldown')) document.getElementById('batch-cooldown').value = settings.batchCooldownMinutes || 10;
    if (document.getElementById('daily-safety-limit')) document.getElementById('daily-safety-limit').value = settings.dailySafetyLimit || 25;
    if (document.getElementById('use-ai-unique')) document.getElementById('use-ai-unique').checked = settings.useAIUniqueOutreach !== false;
    document.getElementById('template-text').value = settings.initialMessageTemplate || '';
    
    const autoOn = settings.autoReplyEnabled !== false;
    const toggle = document.getElementById('auto-reply-toggle');
    if (toggle) toggle.checked = autoOn;
    updateGlobalAutoReplyUI(autoOn);
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

async function loadKnowledge() {
  try {
    const res = await fetch('/api/knowledge');
    knowledge = await res.json();

    document.getElementById('kb-company-name').value = knowledge.companyName || '';
    document.getElementById('kb-about').value = knowledge.about || '';
    document.getElementById('kb-products').value = knowledge.products || '';
    document.getElementById('kb-faqs').value = knowledge.faqs || '';
    document.getElementById('kb-prompt').value = knowledge.systemPrompt || '';
  } catch (e) {
    console.error('Error loading knowledge:', e);
  }
}

async function loadContacts() {
  try {
    const res = await fetch('/api/contacts');
    contacts = await res.json();
    renderContactsTable();
    updateStats();
    checkUnansweredInquiries();
  } catch (e) {
    console.error('Error loading contacts:', e);
  }
}

async function loadChats() {
  try {
    const res = await fetch('/api/chats');
    chats = await res.json();
    renderChatsSidebar();
  } catch (e) {
    console.error('Error loading chats:', e);
  }
}

// ---------------- AUTO-REPLY & INQUIRY CONTROLS ----------------
let pendingInquiryContact = null;

function updateGlobalAutoReplyUI(enabled) {
  const dot = document.getElementById('autoreply-dot');
  const text = document.getElementById('autoreply-text');
  const btn = document.getElementById('btn-toggle-autoreply');
  if (!dot || !text || !btn) return;

  if (enabled) {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    text.textContent = 'الرد التلقائي: شغال';
    btn.className = 'flex items-center space-x-2 space-x-reverse bg-emerald-950/40 border border-emerald-600/60 hover:border-emerald-500 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-sm text-emerald-200';
  } else {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    text.textContent = 'الرد التلقائي: متوقف';
    btn.className = 'flex items-center space-x-2 space-x-reverse bg-rose-950/40 border border-rose-600/60 hover:border-rose-500 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-sm text-rose-200';
  }
}

async function toggleGlobalAutoReply() {
  try {
    const res = await fetch('/api/settings/toggle-autoreply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      updateGlobalAutoReplyUI(data.autoReplyEnabled);
      const toggle = document.getElementById('auto-reply-toggle');
      if (toggle) toggle.checked = data.autoReplyEnabled;
    }
  } catch (e) {
    console.error('Error toggling global auto-reply:', e);
  }
}

async function toggleContactAutoReply(phone) {
  try {
    const clean = phone.replace(/\D/g, '');
    const res = await fetch(`/api/contacts/${clean}/toggle-autoreply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      const contact = contacts.find(c => c.phone.replace(/\D/g, '') === clean);
      if (contact) contact.autoReply = data.autoReply;
      renderActiveChatMessages();
      renderChatsSidebar();
      renderContactsTable();
    }
  } catch (e) {
    console.error('Error toggling contact auto-reply:', e);
  }
}

function checkUnansweredInquiries() {
  const pending = contacts.filter(c => c.needsHumanReply);
  const bar = document.getElementById('unanswered-inquiries-bar');
  const countBadge = document.getElementById('unanswered-count-badge');
  const previewText = document.getElementById('unanswered-preview-text');

  if (!bar) return;

  if (pending.length > 0) {
    pendingInquiryContact = pending[0];
    bar.classList.remove('hidden');
    bar.classList.add('flex');
    if (countBadge) countBadge.textContent = pending.length;
    if (previewText) {
      previewText.textContent = `العميل: ${pendingInquiryContact.name} (${pendingInquiryContact.company || pendingInquiryContact.phone}) - "${pendingInquiryContact.unansweredInquiry || 'طلب التحدث مع مسؤول المبيعات'}"`;
    }
  } else {
    pendingInquiryContact = null;
    bar.classList.add('hidden');
    bar.classList.remove('flex');
  }
}

function openPendingInquiryChat() {
  if (pendingInquiryContact) {
    openChatWith(pendingInquiryContact.phone);
    const input = document.getElementById('manual-msg-input');
    if (input) {
      setTimeout(() => input.focus(), 200);
    }
  }
}

function playNotificationChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {}
}

// ---------------- REALTIME SOCKET EVENTS ----------------
socket.on('connection_status', (data) => {
  updateConnectionUI(data);
});

socket.on('qr_code', (data) => {
  showQRCode(data.qrDataUrl);
});

socket.on('campaign_status', (summary) => {
  updateCampaignUI(summary);
});

let countdownInterval = null;

socket.on('campaign_waiting', (data) => {
  const note = document.getElementById('campaign-progress-note');
  if (!note) return;

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  let remaining = parseInt(data.nextInSeconds) || 0;
  const isCooldown = !!data.isCooldown;
  const contactName = data.nextContact || 'العميل التالي';
  const totalDuration = remaining > 0 ? remaining : 1;

  const updateDisplay = () => {
    if (remaining > 0) {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      const timeFormatted = minutes > 0 ? `${minutes} دقيقة و ${seconds} ثانية` : `${seconds} ثانية`;
      const pct = Math.max(0, Math.min(100, Math.round(((totalDuration - remaining) / totalDuration) * 100)));

      if (isCooldown) {
        note.innerHTML = `
          <div class="flex flex-col gap-2 p-3.5 bg-gradient-to-r from-amber-950/70 to-purple-950/70 border-2 border-amber-500/50 rounded-2xl shadow-xl">
            <div class="flex items-center justify-between text-xs font-bold text-amber-300">
              <span class="flex items-center gap-2">
                <i class="fa-solid fa-mug-hot text-amber-400 fa-bounce text-sm"></i>
                <span>استراحة أمان ذكية (Anti-Ban Cooldown) 🛡️</span>
              </span>
              <span class="font-mono text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-lg">${timeFormatted}</span>
            </div>
            <div class="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-700">
              <div class="bg-gradient-to-r from-amber-500 via-orange-400 to-amber-300 h-2 transition-all duration-1000 ease-linear rounded-full" style="width: ${pct}%"></div>
            </div>
            <div class="text-[11px] text-slate-300 flex items-center justify-between">
              <span>تم إرسال ${data.sessionSentCount || 0} رسائل. النظام يستريح الآن لتجاوز رادار واتساب، وسيستأنف الإرسال تلقائياً.</span>
              <span class="font-mono text-slate-400">${pct}%</span>
            </div>
          </div>
        `;
      } else {
        note.innerHTML = `
          <div class="flex flex-col gap-2 p-3 bg-slate-900/90 border border-emerald-500/40 rounded-xl shadow-lg">
            <div class="flex items-center justify-between text-xs font-bold text-slate-200">
              <span class="flex items-center gap-2">
                <i class="fa-solid fa-shield-halved text-emerald-400 text-sm"></i>
                <span class="text-slate-300">الرسالة التالية ستُرسل إلى:</span>
                <span class="text-amber-300 font-black bg-amber-500/20 px-2.5 py-0.5 rounded-lg border border-amber-500/40 text-xs shadow-sm">${contactName}</span>
              </span>
              <span class="font-mono text-emerald-300 bg-emerald-500/20 px-2.5 py-0.5 rounded-lg border border-emerald-500/30 text-center font-bold">
                ${timeFormatted}
              </span>
            </div>
            <div class="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
              <div class="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 transition-all duration-1000 ease-linear rounded-full" style="width: ${pct}%"></div>
            </div>
            <div class="text-[10px] text-slate-400 flex items-center justify-between">
              <span class="flex items-center gap-1"><i class="fa-solid fa-user-clock text-emerald-400"></i> فاصل زمني بشري آمن (1-3 دقائق) لحماية رقمك من الحظر</span>
              <span class="font-mono text-slate-500">${pct}%</span>
            </div>
          </div>
        `;
      }
      remaining--;
    } else {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      note.innerHTML = `
        <div class="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 font-bold flex items-center gap-2.5 shadow-lg">
          <i class="fa-solid fa-paper-plane fa-bounce text-sm"></i>
          <span>حان وقت الإرسال! جاري الكتابة والإرسال إلى (${contactName}) الآن...</span>
        </div>
      `;
    }
  };

  updateDisplay();
  countdownInterval = setInterval(updateDisplay, 1000);
});

socket.on('campaign_paused_limit', (data) => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const note = document.getElementById('campaign-progress-note');
  if (note) {
    note.innerHTML = `
      <div class="p-3.5 bg-rose-500/20 border border-rose-500/50 rounded-xl text-xs text-rose-300 font-bold flex items-center gap-2.5 shadow-xl">
        <i class="fa-solid fa-triangle-exclamation text-base"></i>
        <span>${data.message || 'تم الوصول إلى الحد الأقصى اليومي الآمن. توقفت الحملة تلقائياً لحماية رقمك.'}</span>
      </div>
    `;
  }
  const btnStart = document.getElementById('btn-start-campaign');
  const btnPause = document.getElementById('btn-pause-campaign');
  if (btnStart) btnStart.classList.remove('hidden');
  if (btnPause) btnPause.classList.add('hidden');
  alert('🛡️ تم إيقاف الحملة مؤقتاً بواسطة درع الأمان!\n' + (data.message || 'تم الوصول إلى الحد اليومي الآمن لحماية حسابك من الحظر.'));
});

socket.on('campaign_completed', () => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  const note = document.getElementById('campaign-progress-note');
  if (note) {
    note.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-circle-check"></i> اكتملت الحملة بنجاح! تم إرسال جميع الرسائل.</span>`;
  }
  document.getElementById('btn-start-campaign').classList.remove('hidden');
  document.getElementById('btn-pause-campaign').classList.add('hidden');
});

socket.on('contact_sent', async (data) => {
  if (data && data.phone) {
    const clean = data.phone.replace(/\D/g, '');
    try {
      const res = await fetch(`/api/chats/${clean}`);
      if (res.ok) {
        chats[clean] = await res.json();
        renderChatsSidebar();
        if (activeChatPhone === clean) {
          renderActiveChatMessages();
        }
      }
    } catch (e) {}
  }
});

socket.on('contacts_updated', (updatedContacts) => {
  contacts = updatedContacts;
  renderContactsTable();
  updateStats();
  renderChatsSidebar();
  checkUnansweredInquiries();
  if (activeChatPhone) {
    renderActiveChatMessages();
  }
});

socket.on('unanswered_inquiry', (data) => {
  playNotificationChime();
  checkUnansweredInquiries();
});

socket.on('procurement_lead_created', (data) => {
  playNotificationChime();
  showProcurementToast(data);
});

function showProcurementToast(data) {
  let toastContainer = document.getElementById('procurement-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'procurement-toast-container';
    toastContainer.className = 'fixed top-20 left-6 z-[9999] flex flex-col gap-3 max-w-md w-full pointer-events-auto';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'bg-gradient-to-r from-emerald-950/95 via-slate-900/95 to-teal-950/95 border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl shadow-emerald-950/60 text-slate-100 flex items-start gap-3 transform transition-all duration-300 translate-y-2 opacity-0';

  const companyName = data.company || 'الشركة';
  const leadName = data.lead?.name || 'مسؤول المشتريات';
  const targetPhone = data.targetPhone || '';
  const referrerName = data.referrer?.name || 'العميل';

  toast.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-lg flex-shrink-0 animate-pulse">
      <i class="fa-solid fa-bullseye"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between">
        <span class="text-xs font-black text-emerald-400 uppercase tracking-wider">🎯 تم رصد وإحالة رقم مشتريات جديد!</span>
        <button onclick="this.closest('.bg-gradient-to-r').remove()" class="text-slate-400 hover:text-white text-xs">&times;</button>
      </div>
      <div class="text-sm font-bold text-white mt-0.5 truncate">${companyName} - ${leadName}</div>
      <div class="text-xs text-slate-300 mt-1">
        أحاله: <span class="text-emerald-300 font-semibold">${referrerName}</span> | الرقم: <span class="text-emerald-300 font-mono font-semibold" dir="ltr">+${targetPhone}</span>
      </div>
      <div class="mt-2.5 flex items-center gap-2">
        <button onclick="openChatWith('${targetPhone}'); this.closest('.bg-gradient-to-r').remove()" class="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow">
          <i class="fa-brands fa-whatsapp"></i>
          <span>فتح الشات فوراً</span>
        </button>
      </div>
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  }, 50);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('opacity-0', '-translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }
  }, 8000);
}

socket.on('unregistered_contact_inbound', (data) => {
  playNotificationChime();
  showUnregisteredContactToast(data);
});

function showUnregisteredContactToast(data) {
  let toastContainer = document.getElementById('procurement-toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'procurement-toast-container';
    toastContainer.className = 'fixed top-20 left-6 z-[9999] flex flex-col gap-3 max-w-md w-full pointer-events-auto';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = 'bg-gradient-to-r from-amber-950/95 via-slate-900/95 to-orange-950/95 border-2 border-amber-500 rounded-2xl p-4 shadow-2xl shadow-amber-950/60 text-slate-100 flex items-start gap-3 transform transition-all duration-300 translate-y-2 opacity-0';

  const name = data.name || 'جهة اتصال جديدة';
  const phone = data.phone || '';
  const textPreview = data.text ? `"${data.text.substring(0, 70)}..."` : '';

  toast.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-lg flex-shrink-0">
      <i class="fa-solid fa-shield-halved"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between">
        <span class="text-xs font-black text-amber-400 uppercase tracking-wider">⚠️ تواصل جديد (غير مسجل بالحملات)</span>
        <button onclick="this.closest('.bg-gradient-to-r').remove()" class="text-slate-400 hover:text-white text-xs">&times;</button>
      </div>
      <div class="text-sm font-bold text-white mt-0.5 truncate">${name} (${phone})</div>
      <div class="text-xs text-amber-200/80 mt-1 line-clamp-2">${textPreview}</div>
      <div class="text-[11px] text-slate-400 mt-1">تم حفظ الرقم وإيقاف الرد الآلي تلقائياً لحمايتك.</div>
      <div class="mt-2.5 flex items-center gap-2">
        <button onclick="openChatWith('${phone}'); this.closest('.bg-gradient-to-r').remove()" class="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow">
          <i class="fa-brands fa-whatsapp"></i>
          <span>فتح المحادثة</span>
        </button>
        <button onclick="approveContactAutoReply('${phone}'); this.closest('.bg-gradient-to-r').remove()" class="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-lg transition-all flex items-center gap-1.5 shadow">
          <i class="fa-solid fa-robot"></i>
          <span>تفعيل البوت للرقم</span>
        </button>
      </div>
    </div>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  }, 50);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('opacity-0', '-translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }
  }, 10000);
}

socket.on('settings_updated', (updatedSettings) => {
  settings = updatedSettings;
  updateGlobalAutoReplyUI(settings.autoReplyEnabled !== false);
  const toggle = document.getElementById('auto-reply-toggle');
  if (toggle) toggle.checked = settings.autoReplyEnabled !== false;
});

socket.on('chats_updated', (updatedChats) => {
  chats = updatedChats;
  renderChatsSidebar();
  if (activeChatPhone) {
    renderActiveChatMessages();
  }
});

socket.on('chat_message', (data) => {
  const { phone, message } = data;
  const clean = phone.replace(/\D/g, '');
  if (!chats[clean]) {
    chats[clean] = [];
  }
  chats[clean].push(message);

  renderChatsSidebar();
  if (activeChatPhone === clean) {
    appendChatMessage(message);
  }

  // Update badge
  const unreadCount = Object.keys(chats).length;
  const badge = document.getElementById('inbox-badge');
  if (badge) {
    badge.textContent = unreadCount;
    badge.classList.toggle('hidden', unreadCount === 0);
  }
});

socket.on('branches_updated', (updatedBranches) => {
  branches = updatedBranches || [];
  renderBranches(branches);
  updateBranchBadges();
});

// ---------------- WHATSAPP UI UPDATES ----------------
function updateConnectionUI(status) {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const qrBox = document.getElementById('qr-box-container');
  const connectedCard = document.getElementById('connected-card');
  const connectedNumberLabel = document.getElementById('connected-number-label');

  if (status.state === 'connected') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
    statusText.textContent = 'الواتساب متصل (' + (status.myNumber || 'جاهز') + ')';
    if (qrBox) qrBox.classList.add('hidden');
    if (connectedCard) {
      connectedCard.classList.remove('hidden');
      connectedNumberLabel.textContent = 'رقم الحساب المرتبط: ' + (status.myNumber || 'متصل');
    }
  } else if (status.state === 'connecting') {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    statusText.textContent = 'جاري الاتصال...';
    if (qrBox) qrBox.classList.remove('hidden');
    if (connectedCard) connectedCard.classList.add('hidden');
  } else {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
    statusText.textContent = 'الواتساب غير متصل';
    if (qrBox) qrBox.classList.remove('hidden');
    if (connectedCard) connectedCard.classList.add('hidden');
  }

  if (status.qrDataUrl || status.qrCode) {
    showQRCode(status.qrDataUrl || status.qrCode);
  }
}

function showQRCode(dataUrl) {
  const img = document.getElementById('qr-image');
  const loader = document.getElementById('qr-loader');
  const qrBox = document.getElementById('qr-box-container');

  if (qrBox) qrBox.classList.remove('hidden');
  if (loader) loader.classList.add('hidden');
  if (img) {
    img.src = dataUrl;
    img.classList.remove('hidden');
  }
}

async function requestReconnect() {
  await fetch('/api/whatsapp/connect', { method: 'POST' });
}

async function logoutWhatsApp() {
  if (confirm('هل أنت متأكد من تسجيل الخروج؟ ستحتاج لمسح QR Code مرة أخرى.')) {
    await fetch('/api/whatsapp/logout', { method: 'POST' });
  }
}

// ---------------- CAMPAIGN UI & STATS ----------------
function updateCampaignUI(summary) {
  if (!summary) return;

  const btnStart = document.getElementById('btn-start-campaign');
  const btnPause = document.getElementById('btn-pause-campaign');
  const note = document.getElementById('campaign-progress-note');

  if (summary.status === 'running') {
    btnStart.classList.add('hidden');
    btnPause.classList.remove('hidden');
    if (!countdownInterval) {
      note.innerHTML = '<span class="text-emerald-400 font-bold"><i class="fa-solid fa-spinner fa-spin"></i> الحملة قيد التشغيل والإرسال الآمن...</span>';
    }
  } else if (summary.status === 'paused') {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    btnStart.classList.remove('hidden');
    btnPause.classList.add('hidden');
    note.innerHTML = '<span class="text-amber-400 font-bold">الحملة متوقفة مؤقتاً. اضغط بدء للاستئناف.</span>';
  } else {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    btnStart.classList.remove('hidden');
    btnPause.classList.add('hidden');
  }

  updateStats();
}

let archiveContacts = [];
let currentCampaignView = 'today';

async function loadArchiveContacts() {
  try {
    const res = await fetch('/api/contacts/archive');
    const data = await res.json();
    if (data.success) {
      archiveContacts = data.archive || [];
      if (document.getElementById('archive-contacts-badge')) {
        document.getElementById('archive-contacts-badge').textContent = archiveContacts.length;
      }
      renderArchiveTable();
    }
  } catch (e) {
    console.error('Error loading archive contacts:', e);
  }
}

function switchCampaignView(view) {
  currentCampaignView = view;
  const btnToday = document.getElementById('btn-view-today');
  const btnArchive = document.getElementById('btn-view-archive');
  const viewTodayContainer = document.getElementById('view-today-container');
  const viewArchiveContainer = document.getElementById('view-archive-container');
  const todayActions = document.getElementById('today-view-actions');
  const archiveActions = document.getElementById('archive-view-actions');

  if (view === 'today') {
    if (btnToday) btnToday.className = 'px-3.5 py-1.5 font-bold text-xs rounded-lg flex items-center gap-2 transition-all bg-emerald-600 text-white shadow-md cursor-pointer';
    if (btnArchive) btnArchive.className = 'px-3.5 py-1.5 font-bold text-xs rounded-lg flex items-center gap-2 transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 cursor-pointer';
    viewTodayContainer?.classList.remove('hidden');
    viewArchiveContainer?.classList.add('hidden');
    todayActions?.classList.remove('hidden');
    archiveActions?.classList.add('hidden');
  } else {
    if (btnToday) btnToday.className = 'px-3.5 py-1.5 font-bold text-xs rounded-lg flex items-center gap-2 transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 cursor-pointer';
    if (btnArchive) btnArchive.className = 'px-3.5 py-1.5 font-bold text-xs rounded-lg flex items-center gap-2 transition-all bg-amber-600 text-white shadow-md cursor-pointer';
    viewTodayContainer?.classList.add('hidden');
    viewArchiveContainer?.classList.remove('hidden');
    todayActions?.classList.add('hidden');
    archiveActions?.classList.remove('hidden');
    renderArchiveTable();
  }
}
window.switchCampaignView = switchCampaignView;

function renderArchiveTable() {
  const tbody = document.getElementById('archive-table-body');
  if (!tbody) return;

  if (!archiveContacts || archiveContacts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-10 text-slate-500">
          لا توجد أرقام مؤرشفة من أيام سابقة حالياً.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = archiveContacts.map((c, i) => {
    const cleanPhone = (c.phone || '').replace(/\D/g, '');
    const dateFormatted = c.sentDate || (c.sentAt ? new Date(c.sentAt).toLocaleDateString('ar-EG') : 'أيام سابقة');
    const lastSnippet = c.lastMessage ? (c.lastMessage.length > 55 ? c.lastMessage.substring(0, 55) + '...' : c.lastMessage) : 'تم التواصل في أيام سابقة';
    
    return `
      <tr class="hover:bg-slate-800/40 transition-colors">
        <td class="px-4 py-3 text-slate-500 text-xs text-center font-bold">${i + 1}</td>
        <td class="px-4 py-3">
          <div class="font-bold text-white text-xs">${escapeHtml(c.company || c.name || 'مكان مسجل')}</div>
          ${c.city ? `<div class="text-[10px] text-slate-400">${escapeHtml(c.city)}</div>` : ''}
        </td>
        <td class="px-4 py-3 font-mono text-emerald-400 text-xs" dir="ltr">
          <a href="https://wa.me/${cleanPhone}" target="_blank" class="hover:underline flex items-center gap-1 font-semibold">
            <i class="fa-brands fa-whatsapp text-sm"></i>
            <span>${c.phone}</span>
          </a>
        </td>
        <td class="px-4 py-3 text-amber-300 text-xs font-semibold whitespace-nowrap">
          <i class="fa-regular fa-calendar-days text-[11px] ml-1"></i>
          <span>${dateFormatted}</span>
        </td>
        <td class="px-4 py-3 text-slate-300 text-[11px] max-w-xs truncate" title="${escapeHtml(c.lastMessage || '')}">
          ${escapeHtml(lastSnippet)}
        </td>
        <td class="px-4 py-3 text-center">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.status === 'replied' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-700/60 text-slate-300 border border-slate-600'}">
            ${c.status === 'replied' ? 'رد على الرسالة' : 'تم الإرسال'}
          </span>
        </td>
        <td class="px-4 py-3 text-center">
          <div class="flex items-center justify-center gap-1.5 flex-nowrap">
            <button onclick="openChatWith('${c.phone}')" class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer" title="عرض الشات المباشر">
              <i class="fa-solid fa-message text-emerald-400"></i>
              <span>الشات</span>
            </button>
            <button onclick="restoreFromArchive('${c.phone}')" class="text-xs bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer font-bold" title="إعادة إدراج هذا الرقم في قائمة حملة اليوم">
              <i class="fa-solid fa-arrow-rotate-left"></i>
              <span>لحملة اليوم</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function restoreFromArchive(phone) {
  if (!confirm(`هل تريد إعادة الرقم (${phone}) إلى قائمة حملة اليوم؟`)) return;
  try {
    const res = await fetch('/api/contacts/archive/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      await loadContacts();
      await loadArchiveContacts();
      switchCampaignView('today');
    } else {
      alert('خطأ: ' + (result.error || 'تعذر الإعادة'));
    }
  } catch (e) {
    alert('حدث خطأ: ' + e.message);
  }
}
window.restoreFromArchive = restoreFromArchive;

async function runArchiveSeparation() {
  try {
    const res = await fetch('/api/contacts/archive/run', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      await loadContacts();
      await loadArchiveContacts();
    } else {
      alert('خطأ: ' + (result.error || 'تعذر الإجراء'));
    }
  } catch (e) {
    alert('حدث خطأ: ' + e.message);
  }
}
window.runArchiveSeparation = runArchiveSeparation;

function updateStats() {
  const total = contacts.length;
  const sent = contacts.filter(c => c.status === 'sent').length;
  const replied = contacts.filter(c => c.status === 'replied').length;
  const pending = contacts.filter(c => c.status === 'pending').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-sent').textContent = sent;
  document.getElementById('stat-replied').textContent = replied;
  document.getElementById('stat-pending').textContent = pending;
  if (document.getElementById('today-contacts-badge')) {
    document.getElementById('today-contacts-badge').textContent = total;
  }
  if (document.getElementById('contacts-count-label')) {
    document.getElementById('contacts-count-label').textContent = `${total} عميل اليوم`;
  }
}

function renderContactsTable() {
  const tbody = document.getElementById('contacts-table-body');
  if (!contacts || contacts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-10 text-slate-500">
          لا توجد جهات اتصال بحملة اليوم حالياً. قم برفع شيت إكسيل أو استيراد عملاء.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = contacts.map((c, i) => {
    let statusBadge = '';
    if (c.needsHumanReply) {
      statusBadge = '<span class="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-xs font-black animate-pulse"><i class="fa-solid fa-triangle-exclamation"></i> بانتظار ردك</span>';
    } else if (c.status === 'sent') {
      statusBadge = '<span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-bold"><i class="fa-solid fa-check"></i> تم الإرسال</span>';
    } else if (c.status === 'replied') {
      statusBadge = '<span class="px-2.5 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-full text-xs font-bold"><i class="fa-solid fa-reply"></i> رد على الرسالة</span>';
    } else if (c.status === 'failed') {
      statusBadge = '<span class="px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded-full text-xs font-bold"><i class="fa-solid fa-triangle-exclamation"></i> فشل</span>';
    } else {
      statusBadge = '<span class="px-2.5 py-1 bg-slate-700/50 text-slate-300 border border-slate-600 rounded-full text-xs font-bold"><i class="fa-regular fa-clock"></i> معلق</span>';
    }

    const isAutoOn = c.autoReply !== false;

    return `
      <tr class="hover:bg-slate-800/40 transition-colors ${c.needsHumanReply ? 'bg-amber-950/20' : ''}">
        <td class="px-4 py-3 text-slate-400 text-xs text-center font-bold">${i + 1}</td>
        <td class="px-4 py-3">
          <div class="font-bold text-white text-xs">${escapeHtml(c.company || 'منشأة مسجلة')}</div>
          ${c.city ? `<div class="text-[10px] text-slate-400">${escapeHtml(c.city)}</div>` : ''}
        </td>
        <td class="px-4 py-3 font-mono text-emerald-400 text-xs" dir="ltr">
          <a href="https://wa.me/${c.phone.replace(/\D/g, '')}" target="_blank" class="hover:underline flex items-center gap-1 font-semibold">
            <i class="fa-brands fa-whatsapp text-sm"></i>
            <span>${c.phone}</span>
          </a>
        </td>
        <td class="px-4 py-3">${statusBadge}</td>
        <td class="px-4 py-3 text-center">
          <button onclick="toggleContactAutoReply('${c.phone}')" class="inline-flex items-center gap-1 text-xs ${isAutoOn ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' : 'text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20'} px-2 py-0.5 rounded-md border font-semibold cursor-pointer transition-all" title="اضغط لتشغيل أو إيقاف الرد الآلي لهذا العميل">
            <i class="fa-solid fa-robot"></i> ${isAutoOn ? 'مفعّل' : 'معطّل'}
          </button>
        </td>
        <td class="px-4 py-3 text-center">
          <div class="flex items-center justify-center gap-1.5 flex-nowrap">
            ${c.needsHumanReply ? `
              <button onclick="openChatWith('${c.phone}')" class="text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-amber-500/20 animate-pulse cursor-pointer" title="الرد يدوياً على استفسار العميل">
                <i class="fa-solid fa-reply"></i>
                <span>رد بنفسي</span>
              </button>
            ` : ''}
            <button onclick="triggerAIFollowup('${c.phone}')" class="text-xs bg-gradient-to-r from-purple-600/30 to-indigo-600/30 hover:from-purple-600/50 hover:to-indigo-600/50 text-purple-300 border border-purple-500/40 px-2.5 py-1.5 rounded-xl font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer" title="تشغيل المحادثة: يقرأ الشات القديم أو يبدأ من جديد">
              <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
              <span>تشغيل المحادثة</span>
            </button>
            <button onclick="openChatWith('${c.phone}')" class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer" title="فتح الشات المباشر">
              <i class="fa-solid fa-message text-emerald-400"></i>
            </button>
            <button onclick="deleteSingleContact('${c.phone}')" class="text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1 cursor-pointer" title="حذف هذا الرقم من الحملة">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------- EXCEL DRAG & DROP ----------------
function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('excel-file-input');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-emerald-500', 'bg-emerald-500/5');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-emerald-500', 'bg-emerald-500/5');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-emerald-500', 'bg-emerald-500/5');
    if (e.dataTransfer.files.length) {
      uploadExcelFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      uploadExcelFile(fileInput.files[0]);
    }
  });
}

async function uploadExcelFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const dropzone = document.getElementById('dropzone');
  dropzone.innerHTML = `<div class="text-sm font-bold text-emerald-400"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2"></i><br>جاري قراءة واستخراج البيانات من الملف...</div>`;

  try {
    const res = await fetch('/api/contacts/upload', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (result.success) {
      alert(`🎉 تم بنجاح! تم استخراج ${result.count} جهة اتصال من الملف.`);
      await loadContacts();
    } else {
      alert('خطأ أثناء قراءة الملف: ' + result.error);
    }
  } catch (err) {
    alert('حدث خطأ أثناء رفع الملف.');
  } finally {
    // Reset dropzone
    dropzone.innerHTML = `
      <input type="file" id="excel-file-input" accept=".xlsx, .xls, .csv" class="hidden">
      <i class="fa-solid fa-cloud-arrow-up text-3xl text-slate-400 mb-2"></i>
      <div class="text-sm font-bold text-slate-200">اضغط لاختيار الملف أو اسحبه هنا</div>
      <div class="text-xs text-slate-500 mt-1">يدعم ملفات Excel و CSV</div>
    `;
    setupDropzone();
  }
}

async function loadRamadanSampleDirectly() {
  try {
    const res = await fetch('/api/contacts/load-ramadan-sample', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      contacts = data.contacts;
      renderContactsTable();
      updateStats();
      renderChatsSidebar();
      alert(`تم استيراد ${data.count} عميل من العاشر من رمضان والإسماعيلية بنجاح!`);
    } else {
      alert('فشل استيراد البيانات: ' + data.error);
    }
  } catch (err) {
    alert('حدث خطأ في تحميل البيانات.');
  }
}

async function loadAllEgyptVerifiedDirectly() {
  try {
    const res = await fetch('/api/contacts/load-all-egypt-verified', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      contacts = data.contacts;
      renderContactsTable();
      updateStats();
      renderChatsSidebar();
      alert(`✅ تم استيراد ${data.count} عميل حقيقي من كافة محافظات مصر (كلهم مؤكدين واتساب 100%) بنجاح!`);
    } else {
      alert('فشل استيراد البيانات: ' + data.error);
    }
  } catch (err) {
    alert('حدث خطأ في استيراد بيانات عملاء محافظات مصر.');
  }
}

function downloadSampleExcel() {
  const csvContent = "\uFEFFالاسم,الشركة,رقم الواتساب,ملاحظات\nم. أحمد الشريف,سلسلة مطاعم وكافيهات الزهور,01012345678,عميل مواد تعبئة وتغليف (أكواب وسلطانيات)\nأ. محمود عبد الرحمن,شركة النور للمقاولات,01187654321,مشروع واجهات وقطاعات ألومنيوم\nم. طارق علي,حلواني ومخبوزات الفرسان,01234567890,عميل أطباق فوم وعلب واسترتش\nأ. سامح إبراهيم,مصنع البركة للصناعات الغذائية,01098765432,عميل كرتون ورولات تغليف";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", "sample_contacts.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function clearFailedContacts() {
  if (!confirm('هل تريد حذف جميع الأرقام التي فشلت لعدم وجود حساب واتساب لها؟')) return;
  try {
    const res = await fetch('/api/contacts/clear-failed', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      contacts = contacts.filter(c => c.status !== 'failed');
      renderContactsTable();
      updateStats();
      alert(result.message || 'تم حذف الأرقام الفاشلة بنجاح.');
    } else {
      alert('خطأ: ' + (result.error || 'تعذر الحذف'));
    }
  } catch (e) {
    alert('حدث خطأ: ' + e.message);
  }
}
window.clearFailedContacts = clearFailedContacts;

async function clearContacts() {
  if (confirm('هل أنت متأكد من مسح جميع جهات الاتصال المسجلة؟')) {
    await fetch('/api/contacts/clear', { method: 'POST' });
    contacts = [];
    renderContactsTable();
    updateStats();
  }
}

async function deleteSingleContact(phone) {
  if (!confirm(`هل أنت متأكد من حذف هذا الرقم (${phone}) من الحملة نهائياً؟`)) return;
  try {
    const res = await fetch(`/api/contacts/${encodeURIComponent(phone)}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      contacts = contacts.filter(c => c.phone.replace(/\D/g, '') !== phone.replace(/\D/g, ''));
      renderContactsTable();
      updateStats();
    } else {
      alert('خطأ أثناء الحذف: ' + (result.error || 'تعذر الحذف'));
    }
  } catch (e) {
    alert('حدث خطأ أثناء الحذف: ' + e.message);
  }
}
window.deleteSingleContact = deleteSingleContact;

async function sanitizeAllContacts() {
  if (!confirm('هل تريد تنظيف كافة جهات الاتصال واعتماد المخاطبة الرسمية "يا فندم" لجميع الأرقام وحذف أرقام الاختبار القديمة؟')) return;
  try {
    const res = await fetch('/api/contacts/sanitize-names', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      alert(result.message);
      await loadContacts();
    } else {
      alert('خطأ: ' + result.error);
    }
  } catch (e) {
    alert('حدث خطأ: ' + e.message);
  }
}
window.sanitizeAllContacts = sanitizeAllContacts;

// ---------------- CAMPAIGN ACTIONS ----------------
async function startCampaign() {
  await saveKnowledgeAndSettings(false);
  try {
    const res = await fetch('/api/campaign/start', { method: 'POST' });
    const result = await res.json();
    if (!result.success) {
      alert('تعذر بدء الحملة: ' + result.error);
    }
  } catch (err) {
    alert('حدث خطأ في بدء الحملة');
  }
}

async function pauseCampaign() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  await fetch('/api/campaign/pause', { method: 'POST' });
}

async function resetCampaign() {
  if (confirm('هل تريد إعادة تعيين حالة جميع الأرقام إلى "معلق" للبدء من جديد؟')) {
    await fetch('/api/campaign/reset', { method: 'POST' });
  }
}

// ---------------- KNOWLEDGE & SETTINGS ----------------
async function saveKnowledgeAndSettings(showAlert = true) {
  const updatedSettings = {
    provider: document.getElementById('ai-provider').value,
    model: document.getElementById('ai-model').value,
    apiKey: document.getElementById('ai-api-key').value,
    minDelaySeconds: Math.max(45, parseInt(document.getElementById('min-delay')?.value, 10) || 60),
    maxDelaySeconds: Math.max(60, parseInt(document.getElementById('max-delay')?.value, 10) || 180),
    batchSize: Math.max(1, parseInt(document.getElementById('batch-size')?.value, 10) || 5),
    batchCooldownMinutes: Math.max(2, parseInt(document.getElementById('batch-cooldown')?.value, 10) || 10),
    dailySafetyLimit: Math.max(5, parseInt(document.getElementById('daily-safety-limit')?.value, 10) || 25),
    useAIUniqueOutreach: document.getElementById('use-ai-unique') ? document.getElementById('use-ai-unique').checked : true,
    initialMessageTemplate: document.getElementById('template-text').value,
    autoReplyEnabled: document.getElementById('auto-reply-toggle').checked
  };

  const updatedKnowledge = {
    companyName: document.getElementById('kb-company-name').value,
    about: document.getElementById('kb-about').value,
    products: document.getElementById('kb-products').value,
    faqs: document.getElementById('kb-faqs').value,
    systemPrompt: document.getElementById('kb-prompt').value
  };

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSettings)
    });

    await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedKnowledge)
    });

    if (showAlert) {
      alert('✅ تم حفظ الإعدادات وقاعدة المعرفة بنجاح!');
    }
  } catch (err) {
    if (showAlert) alert('حدث خطأ أثناء حفظ البيانات.');
  }
}

async function applyWarmupPreset() {
  if (document.getElementById('min-delay')) document.getElementById('min-delay').value = 120;
  if (document.getElementById('max-delay')) document.getElementById('max-delay').value = 300;
  if (document.getElementById('batch-size')) document.getElementById('batch-size').value = 3;
  if (document.getElementById('batch-cooldown')) document.getElementById('batch-cooldown').value = 15;
  if (document.getElementById('daily-safety-limit')) document.getElementById('daily-safety-limit').value = 12;
  if (document.getElementById('use-ai-unique')) document.getElementById('use-ai-unique').checked = true;
  
  await saveKnowledgeAndSettings(false);
  alert('🛡️ تم تفعيل "وضع الإحماء الفائق بعد فك الحظر" وحفظه بنجاح!\n\n• الفاصل بين الرسائل: 2 إلى 5 دقائق عشوائي\n• استراحة أمان كل 3 رسائل لمدة 15 دقيقة كاملة\n• حد أمان يومي صارم: 12 رسالة فقط كبداية تدريجية\n• صياغة ذكية بالذكاء الاصطناعي (رسالة فريدة مخصصة لكل عميل لمنع بصمة التكرار)');
}
window.applyWarmupPreset = applyWarmupPreset;

function onProviderChange() {
  const provider = document.getElementById('ai-provider').value;
  const modelSelect = document.getElementById('ai-model');

  if (provider === 'openai') {
    modelSelect.innerHTML = `
      <option value="gpt-4o-mini">gpt-4o-mini (سريع واقتصادي)</option>
      <option value="gpt-4o">gpt-4o (الأعلى ذكاءً)</option>
    `;
  } else {
    modelSelect.innerHTML = `
      <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (موصى به - فائق السرعة)</option>
      <option value="gemini-3.6-flash">gemini-3.6-flash (سريع ودقيق)</option>
      <option value="gemini-3.8-flash">gemini-3.8-flash (الأحدث والأقوى)</option>
    `;
  }
}

async function testAIReply() {
  const input = document.getElementById('test-ai-input');
  const output = document.getElementById('test-ai-output');
  const question = input.value.trim();

  if (!question) return;

  output.classList.remove('hidden');
  output.innerHTML = '<span class="text-purple-400"><i class="fa-solid fa-spinner fa-spin"></i> جاري التفكير وتوليد الرد بالذكاء الاصطناعي...</span>';

  try {
    const res = await fetch('/api/test-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question })
    });
    const data = await res.json();
    output.innerHTML = `<strong>الرد التجريبي:</strong><br>${data.reply.replace(/\n/g, '<br>')}`;
  } catch (err) {
    output.innerHTML = '<span class="text-rose-400">حدث خطأ في اختبار الرد.</span>';
  }
}

// ---------------- LIVE INBOX CHATS ----------------
async function openChatWith(phone) {
  const clean = phone.replace(/\D/g, '');
  activeChatPhone = clean;
  switchTab('tab-inbox');
  renderChatsSidebar();
  renderActiveChatMessages();

  try {
    const res = await fetch(`/api/chats/${clean}`);
    if (res.ok) {
      chats[clean] = await res.json();
      renderChatsSidebar();
      if (activeChatPhone === clean) {
        renderActiveChatMessages();
      }
    }
  } catch (e) {}
}

// ---------------- MODAL: ADD CONTACT MANUALLY ----------------
let modalShouldOpenChat = false;

function openAddContactModal(openChatDirectly = false) {
  modalShouldOpenChat = openChatDirectly;
  const modal = document.getElementById('add-contact-modal');
  if (!modal) return;
  document.getElementById('modal-phone').value = '';
  document.getElementById('modal-name').value = '';
  document.getElementById('modal-company').value = '';
  document.getElementById('modal-city').value = '';
  document.getElementById('modal-activity').value = '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => {
    document.getElementById('modal-phone').focus();
  }, 100);
}

function closeAddContactModal() {
  const modal = document.getElementById('add-contact-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function submitAddContactModal(forceOpenChat = null) {
  const shouldOpen = forceOpenChat !== null ? forceOpenChat : modalShouldOpenChat;
  const phone = document.getElementById('modal-phone').value.trim();
  const name = document.getElementById('modal-name').value.trim();
  const company = document.getElementById('modal-company').value.trim();
  const city = document.getElementById('modal-city').value.trim();
  const activity = document.getElementById('modal-activity').value.trim();

  if (!phone) {
    alert('من فضلك أدخل رقم الهاتف أو الواتساب.');
    document.getElementById('modal-phone').focus();
    return;
  }

  try {
    const res = await fetch('/api/contacts/add-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name, company, city, activity })
    });
    const data = await res.json();
    if (!data.success) {
      alert('خطأ: ' + (data.error || 'تعذر إضافة الرقم'));
      return;
    }

    closeAddContactModal();
    await loadContacts();

    if (shouldOpen && data.contact) {
      openChatWith(data.contact.phone);
    }
  } catch (err) {
    alert('حدث خطأ أثناء حفظ الرقم: ' + err.message);
  }
}

function promptNewChat() {
  openAddContactModal(true);
}

async function loadSampleContactsDirectly() {
  const sampleData = [
    { name: 'م. أحمد الشريف', company: 'سلسلة مطاعم وكافيهات الزهور', phone: '201012345678', notes: 'عميل مواد تعبئة وتغليف (أكواب وسلطانيات)', status: 'pending', autoReply: true },
    { name: 'أ. محمود عبد الرحمن', company: 'شركة النور للمقاولات', phone: '201187654321', notes: 'مشروع واجهات وقطاعات ألومنيوم', status: 'pending', autoReply: true },
    { name: 'م. طارق علي', company: 'حلواني ومخبوزات الفرسان', phone: '201234567890', notes: 'عميل أطباق فوم وعلب واسترتش', status: 'pending', autoReply: true },
    { name: 'أ. سامح إبراهيم', company: 'مصنع البركة للصناعات الغذائية', phone: '201098765432', notes: 'عميل كرتون ورولات تغليف', status: 'pending', autoReply: true }
  ];

  for (const s of sampleData) {
    if (!contacts.some(c => c.phone === s.phone)) {
      contacts.push({ id: 'smp_' + Math.random().toString(36).substring(2, 7), ...s });
    }
  }

  renderContactsTable();
  updateStats();
  renderChatsSidebar();
  if (contacts.length > 0) {
    openChatWith(contacts[0].phone);
  }
}

function renderChatsSidebar() {
  const listContainer = document.getElementById('chats-sidebar-list');
  const searchInput = (document.getElementById('search-chats')?.value || '').trim().toLowerCase();

  // Only show contacts from the uploaded campaign/contacts list or explicitly opened chats
  const targetPhones = contacts.map(c => c.phone.replace(/\D/g, ''));
  const allPhonesSet = new Set(targetPhones);

  if (allPhonesSet.size === 0) {
    listContainer.innerHTML = '<div class="p-6 text-center text-slate-500 text-xs">لا توجد جهات اتصال بعد.<br>قم برفع شيت إكسيل في تبويب الحملة أو اضغط على + لبدء محادثة.</div>';
    return;
  }

  let phoneArray = Array.from(allPhonesSet);

  // Filter with search if entered
  if (searchInput) {
    phoneArray = phoneArray.filter(p => {
      const contact = contacts.find(c => c.phone.replace(/\D/g, '') === p) || {};
      const name = (contact.name || '').toLowerCase();
      const comp = (contact.company || '').toLowerCase();
      return p.includes(searchInput) || name.includes(searchInput) || comp.includes(searchInput);
    });
  }

  // Sort: chats with recent messages first
  phoneArray.sort((a, b) => {
    const msgsA = chats[a] || [];
    const msgsB = chats[b] || [];
    const lastA = msgsA.length > 0 ? new Date(msgsA[msgsA.length - 1].timestamp || 0).getTime() : 0;
    const lastB = msgsB.length > 0 ? new Date(msgsB[msgsB.length - 1].timestamp || 0).getTime() : 0;
    return lastB - lastA;
  });

  listContainer.innerHTML = phoneArray.map(p => {
    const contact = contacts.find(c => c.phone.replace(/\D/g, '') === p) || { name: 'عميل ' + p.slice(-4), company: '' };
    const chatMsgs = chats[p] || [];
    const lastMsg = chatMsgs.length > 0 ? chatMsgs[chatMsgs.length - 1] : null;
    const isSelected = activeChatPhone === p;
    const needsReply = contact.needsHumanReply;

    return `
      <div onclick="selectChat('${p}')" class="p-3.5 cursor-pointer hover:bg-slate-800/60 transition-colors flex items-center justify-between ${isSelected ? 'bg-slate-800 border-r-4 border-emerald-400' : ''} ${needsReply ? 'bg-amber-950/20' : ''}">
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-9 h-9 rounded-full ${needsReply ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse' : 'bg-slate-700 text-slate-300'} flex items-center justify-center font-bold text-sm flex-shrink-0">
            ${needsReply ? '<i class="fa-solid fa-bell text-xs"></i>' : (contact.name[0] || 'ع')}
          </div>
          <div class="overflow-hidden">
            <div class="font-bold text-xs text-white truncate flex items-center gap-1.5">
              <span>${contact.name}</span>
              ${needsReply ? '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] px-1.5 py-0.5 rounded font-black">⚠️ رد يدوي</span>' : ''}
            </div>
            <div class="text-[11px] text-slate-400 truncate">${contact.company || p}</div>
            <div class="text-[10px] text-slate-500 truncate mt-0.5">
              ${lastMsg ? (lastMsg.fromMe ? (lastMsg.isAI ? '🤖 ' : 'أنت: ') : '') + lastMsg.text : 'اضغط لبدء محادثة...'}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function selectChat(phone) {
  const clean = phone.replace(/\D/g, '');
  activeChatPhone = clean;
  renderChatsSidebar();
  renderActiveChatMessages();

  try {
    const res = await fetch(`/api/chats/${clean}`);
    if (res.ok) {
      chats[clean] = await res.json();
      renderChatsSidebar();
      if (activeChatPhone === clean) {
        renderActiveChatMessages();
      }
    }
  } catch (e) {}
}

function renderActiveChatMessages() {
  if (!activeChatPhone) return;

  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === activeChatPhone) || { name: 'عميل', company: '', phone: activeChatPhone };

  document.getElementById('chat-header-avatar').textContent = contact.name[0] || 'ع';
  document.getElementById('chat-header-name').textContent = `${contact.name} (${contact.company || 'عميل'})`;
  document.getElementById('chat-header-phone').textContent = contact.phone;

  const actionsEl = document.getElementById('chat-header-actions');
  if (actionsEl) {
    const isAutoOn = contact.autoReply !== false;
    actionsEl.innerHTML = `
      ${contact.needsHumanReply ? `
        <span class="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs px-2.5 py-1.5 rounded-xl font-bold flex items-center gap-1 animate-pulse">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>بانتظار ردك اليدوي</span>
        </span>
      ` : ''}

      <button onclick="sendCatalogToActiveChat()" class="bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer" title="إرسال كتالوج المنتجات للعميل عبر واتساب">
        <i class="fa-solid fa-file-pdf"></i>
        <span>إرسال الكتالوج</span>
      </button>

      <button onclick="toggleContactAutoReply('${contact.phone}')" class="px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 font-bold transition-all ${isAutoOn ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25' : 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'} cursor-pointer" title="تشغيل أو إيقاف الرد التلقائي لهذا العميل">
        <span class="w-2 h-2 rounded-full ${isAutoOn ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
        <span>الرد الآلي: ${isAutoOn ? 'مفعل' : 'معطل'}</span>
      </button>

      <button onclick="triggerAIFollowup('${contact.phone}')" class="bg-gradient-to-r from-purple-600/90 to-indigo-600/90 hover:from-purple-600 hover:to-indigo-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md shadow-purple-500/20 transition-all cursor-pointer" title="قراءة الشات القديم وتوليد متابعة ذكية، أو البدء من جديد">
        <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
        <span>تشغيل المحادثة الذكية</span>
      </button>
    `;
  }

  document.getElementById('manual-msg-input').disabled = false;
  document.getElementById('btn-send-manual').disabled = false;

  const container = document.getElementById('chat-messages-container');
  const msgs = chats[activeChatPhone] || [];

  let approvalBanner = '';
  if (contact.pendingApproval || contact.isUnsolicited) {
    approvalBanner = `
      <div class="bg-amber-950/70 border-2 border-amber-500/50 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs text-amber-200 mb-2 shadow-lg">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-shield-halved text-amber-400 text-base"></i>
          <span><strong>رقم تواصل جديد من خارج الحملة:</strong> تم حفظ الرقم وإيقاف الرد الآلي تلقائياً لحمايتك. هل تريد تفعيل البوت له؟</span>
        </div>
        <button onclick="approveContactAutoReply('${contact.phone}')" class="bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 rounded-xl font-black text-xs transition-all whitespace-nowrap shadow cursor-pointer">
          تفعيل البوت للرقم
        </button>
      </div>
    `;
  }

  if (msgs.length === 0) {
    if (!window._fetchingChat || window._fetchingChat !== activeChatPhone) {
      window._fetchingChat = activeChatPhone;
      fetch(`/api/chats/${activeChatPhone}`)
        .then(r => r.json())
        .then(serverMsgs => {
          if (serverMsgs && serverMsgs.length > 0) {
            chats[activeChatPhone] = serverMsgs;
            renderChatsSidebar();
            renderActiveChatMessages();
          }
        })
        .catch(() => {});
    }

    container.innerHTML = `
      ${approvalBanner}
      <div class="text-center text-slate-500 text-xs my-auto flex flex-col items-center gap-3 py-10">
        <div class="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xl text-slate-400">
          <i class="fa-solid fa-comments"></i>
        </div>
        <div class="font-bold text-slate-300">لا توجد رسائل سابقة مع هذا العميل.</div>
        <p class="text-[11px] text-slate-500 max-w-xs">يمكنك البدء من جديد برسالة تسويقية ذكية ومخصصة لـ (${contact.name}) بضغطة زر واحدة.</p>
        <button onclick="triggerAIFollowup('${contact.phone}')" class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-purple-500/20 transition-all">
          <i class="fa-solid fa-wand-magic-sparkles text-amber-300"></i>
          <span>البدء بالذكاء الاصطناعي من جديد 🚀</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = approvalBanner + msgs.map(m => {
    let bubbleClass = 'chat-bubble-user';
    let senderLabel = contact.name;
    let badge = '';

    if (m.fromMe) {
      if (m.isAI) {
        bubbleClass = 'chat-bubble-ai';
        senderLabel = 'الذكاء الاصطناعي (AI)';
        badge = '<span class="text-[10px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded font-mono ml-1">🤖 AI</span>';
      } else {
        bubbleClass = 'chat-bubble-me';
        senderLabel = 'أنت (يدوي)';
      }
    }

    return `
      <div class="flex flex-col ${m.fromMe ? 'items-end' : 'items-start'} max-w-[80%]">
        <div class="text-[10px] text-slate-400 mb-0.5 flex items-center">
          ${senderLabel} ${badge}
        </div>
        <div class="p-3 rounded-2xl text-xs leading-relaxed ${bubbleClass}">
          ${m.text.replace(/\n/g, '<br>')}
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function appendChatMessage(m) {
  const container = document.getElementById('chat-messages-container');
  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === activeChatPhone) || { name: 'عميل' };

  let bubbleClass = m.fromMe ? (m.isAI ? 'chat-bubble-ai' : 'chat-bubble-me') : 'chat-bubble-user';
  let senderLabel = m.fromMe ? (m.isAI ? 'الذكاء الاصطناعي (AI)' : 'أنت (يدوي)') : contact.name;
  let badge = (m.fromMe && m.isAI) ? '<span class="text-[10px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded font-mono ml-1">🤖 AI</span>' : '';

  const msgDiv = document.createElement('div');
  msgDiv.className = `flex flex-col ${m.fromMe ? 'items-end' : 'items-start'} max-w-[80%]`;
  msgDiv.innerHTML = `
    <div class="text-[10px] text-slate-400 mb-0.5 flex items-center">
      ${senderLabel} ${badge}
    </div>
    <div class="p-3 rounded-2xl text-xs leading-relaxed ${bubbleClass}">
      ${m.text.replace(/\n/g, '<br>')}
    </div>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

async function sendManualMessage() {
  const input = document.getElementById('manual-msg-input');
  const text = input.value.trim();
  if (!text || !activeChatPhone) return;

  input.value = '';
  try {
    await fetch(`/api/chats/${activeChatPhone}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    alert('حدث خطأ أثناء إرسال الرسالة.');
  }
}

// ---------------- AI FOLLOWUP & CONVERSATION RESUME ----------------
let currentFollowupPhone = null;

async function triggerAIFollowup(phone) {
  if (!phone) return;
  const cleanPhone = phone.replace(/\D/g, '');
  currentFollowupPhone = cleanPhone;

  const contact = contacts.find(c => c.phone.replace(/\D/g, '') === cleanPhone) || { name: 'يا فندم', company: '', phone: cleanPhone };
  
  const modal = document.getElementById('ai-followup-modal');
  const loading = document.getElementById('followup-loading');
  const content = document.getElementById('followup-content');
  const contactLabel = document.getElementById('followup-contact-label');
  const badge = document.getElementById('followup-context-badge');
  const textArea = document.getElementById('followup-text-area');

  contactLabel.textContent = `العميل: ${contact.name} (${contact.company || 'شركتكم الموقرة'}) - ${contact.phone}`;
  badge.className = 'text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700';
  badge.textContent = 'جاري التحليل...';
  
  loading.classList.remove('hidden');
  content.classList.add('hidden');
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  try {
    const res = await fetch(`/api/contacts/${cleanPhone}/ai-followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendImmediately: false })
    });
    const data = await res.json();
    if (!data.success) {
      alert('خطأ في توليد المحادثة: ' + (data.error || 'غير معروف'));
      closeAIFollowupModal();
      return;
    }

    textArea.value = data.text || '';
    if (data.hasHistory && data.historyCount > 0) {
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold';
      badge.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> متابعة ذكية بناءً على الشات السابق (${data.historyCount} رسائل) 🧠`;
    } else {
      badge.className = 'text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold';
      badge.innerHTML = `<i class="fa-solid fa-paper-plane text-emerald-300"></i> رسالة افتتاحية للحملة (وسيتولى الذكاء الرد تلقائياً على رد العميل) 🤖`;
    }

    loading.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (err) {
    alert('حدث خطأ أثناء الاتصال: ' + err.message);
    closeAIFollowupModal();
  }
}

function closeAIFollowupModal() {
  const modal = document.getElementById('ai-followup-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function regenerateFollowup() {
  if (currentFollowupPhone) {
    await triggerAIFollowup(currentFollowupPhone);
  }
}

async function sendFollowupNow() {
  const text = document.getElementById('followup-text-area').value.trim();
  if (!text) {
    alert('نص الرسالة فارغ.');
    return;
  }
  if (!currentFollowupPhone) return;

  const btn = document.getElementById('btn-send-followup-now');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإرسال...';

  try {
    const res = await fetch(`/api/chats/${currentFollowupPhone}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!data.success) {
      alert('خطأ أثناء الإرسال: ' + (data.error || 'فشل إرسال الرسالة'));
      return;
    }

    closeAIFollowupModal();
    openChatWith(currentFollowupPhone);
  } catch (err) {
    alert('خطأ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function editFollowupInChat() {
  const text = document.getElementById('followup-text-area').value.trim();
  closeAIFollowupModal();
  if (currentFollowupPhone) {
    openChatWith(currentFollowupPhone);
    const input = document.getElementById('manual-msg-input');
    if (input) {
      input.value = text;
      input.focus();
    }
  }
}

// Enter key to send manual message
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('manual-msg-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendManualMessage();
      }
    });
  }

  const testInput = document.getElementById('test-ai-input');
  if (testInput) {
    testInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        testAIReply();
      }
    });
  }

  const searchInput = document.getElementById('search-chats');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderChatsSidebar();
    });
  }

  const pdfInput = document.getElementById('catalog-pdf-file-input');
  if (pdfInput) {
    pdfInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.name.endsWith('.pdf')) {
        alert('يجب أن يكون الملف بصيغة PDF.');
        return;
      }

      const statusEl = document.getElementById('catalog-upload-status');
      if (statusEl) statusEl.innerHTML = '<span class="text-purple-400 font-bold"><i class="fa-solid fa-spinner fa-spin"></i> جاري رفع ملف الكتالوج...</span>';

      const formData = new FormData();
      formData.append('catalogFile', file);

      try {
        const res = await fetch('/api/catalog/upload-pdf', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          alert('تم رفع وتحديث كتالوج الـ PDF بنجاح! سيتم إرساله للعملاء عند الطلب.');
          await loadCatalogStatus();
          if (statusEl) statusEl.innerHTML = '<span class="text-emerald-400 font-bold"><i class="fa-solid fa-check"></i> تم التحديث</span>';
        } else {
          alert('خطأ في الرفع: ' + (data.error || 'تعذر رفع الملف'));
          if (statusEl) statusEl.textContent = '';
        }
      } catch (err) {
        alert('حدث خطأ أثناء رفع الملف: ' + err.message);
        if (statusEl) statusEl.textContent = '';
      }
    });
  }
});

// ── Catalog Management Functions ──
async function loadCatalogStatus() {
  try {
    const res = await fetch('/api/catalog/status');
    const data = await res.json();
    const badge = document.getElementById('catalog-pdf-badge');
    const linkInput = document.getElementById('catalog-link-input');
    const modeSelect = document.getElementById('catalog-mode-select');

    if (badge) {
      if (data.hasPdf) {
        badge.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-circle-check"></i> متوفر (${data.sizeMb} MB)</span>`;
      } else {
        badge.innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-circle-info"></i> غير مرفوع (يتم إرسال الرابط)</span>`;
      }
    }
    if (linkInput && data.catalogLink) {
      linkInput.value = data.catalogLink;
    }
    if (modeSelect && data.catalogMode) {
      modeSelect.value = data.catalogMode;
    }
  } catch (e) {}
}

async function saveCatalogSettings() {
  try {
    const catalogLink = document.getElementById('catalog-link-input')?.value.trim();
    const catalogMode = document.getElementById('catalog-mode-select')?.value;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogLink, catalogMode })
    });
    const data = await res.json();
    if (data.success) {
      alert('تم حفظ إعدادات الكتالوج والرابط بنجاح!');
    }
  } catch (e) {
    alert('حدث خطأ أثناء الحفظ: ' + e.message);
  }
}

async function sendCatalogToActiveChat() {
  if (!activeChatPhone) return;
  if (!confirm('هل تريد إرسال كتالوج المنتجات للعميل عبر واتساب الآن؟')) return;
  try {
    const res = await fetch(`/api/chats/${activeChatPhone}/send-catalog`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert('تم إرسال الكتالوج للعميل بنجاح!');
    } else {
      alert('خطأ: ' + (data.error || 'تعذر الإرسال'));
    }
  } catch (e) {
    alert('حدث خطأ أثناء إرسال الكتالوج: ' + e.message);
  }
}

async function approveContactAutoReply(phone) {
  try {
    const clean = phone.replace(/\D/g, '');
    const res = await fetch(`/api/contacts/${clean}/approve-autoreply`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadContacts();
      renderActiveChatMessages();
    }
  } catch (e) {
    alert('حدث خطأ: ' + e.message);
  }
}

// ---------------- HTML ESCAPE HELPER ----------------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------- BRANCHES & SHOWROOMS MANAGEMENT ----------------
function updateBranchBadges() {
  const badge = document.getElementById('branches-badge');
  const countPill = document.getElementById('branches-count-pill');
  const count = (branches && Array.isArray(branches)) ? branches.length : 0;
  if (badge) badge.textContent = count;
  if (countPill) countPill.textContent = `${count} ${count === 1 ? 'فرع' : 'فروع'}`;
}

async function loadBranches() {
  try {
    const res = await fetch('/api/branches');
    const data = await res.json();
    if (data.success) {
      branches = data.branches || [];
      renderBranches(branches);
      updateBranchBadges();
    }
  } catch (err) {
    console.error('Error loading branches:', err);
  }
}

function renderBranches(listToRender) {
  const container = document.getElementById('branches-list-container');
  if (!container) return;

  if (!listToRender || listToRender.length === 0) {
    container.innerHTML = `
      <div class="col-span-1 md:col-span-2 py-12 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-dashed border-slate-700/60 p-6 flex flex-col items-center justify-center gap-2">
        <i class="fa-solid fa-map-location-dot text-3xl text-slate-600 mb-1"></i>
        <div class="text-xs font-bold text-slate-300">لا توجد معارض أو فروع مسجلة</div>
        <div class="text-[11px] text-slate-500">استخدم النموذج لإضافة معرضك الأول مع رابط خرائط جوجل وسيتعرف عليه الـ AI تلقائياً</div>
      </div>
    `;
    return;
  }

  container.innerHTML = listToRender.map(branch => {
    const mapUrl = branch.mapLink || '#';
    const isExternal = branch.mapLink && branch.mapLink.startsWith('http');
    const servedChips = (branch.servedAreas || '')
      .split(/[,،]/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => `<span class="inline-block bg-slate-800 border border-slate-700/60 text-slate-300 text-[10px] px-2 py-0.5 rounded-md">${escapeHtml(s)}</span>`)
      .join(' ');

    return `
      <div class="bg-slate-900/90 border border-slate-800 hover:border-rose-500/40 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all group shadow-sm hover:shadow-lg hover:shadow-rose-500/5">
        <div>
          <!-- Top Row: Name & Action Buttons -->
          <div class="flex items-start justify-between gap-2 mb-2">
            <div>
              <h4 class="text-sm font-black text-white group-hover:text-rose-300 transition-colors flex items-center gap-1.5">
                <i class="fa-solid fa-location-dot text-rose-400 text-xs"></i>
                <span>${escapeHtml(branch.name)}</span>
              </h4>
              <div class="flex items-center gap-1.5 mt-1">
                <span class="text-[11px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-lg">
                  ${escapeHtml(branch.city || 'المدينة غير محددة')}
                </span>
                ${branch.governorate ? `<span class="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-lg">${escapeHtml(branch.governorate)}</span>` : ''}
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="editBranch('${branch.id}')" title="تعديل بيانات المعرض"
                class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-500/30 flex items-center justify-center text-xs transition-all">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button type="button" onclick="deleteBranch('${branch.id}', '${escapeHtml(branch.name)}')" title="حذف المعرض"
                class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 flex items-center justify-center text-xs transition-all">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </div>

          <!-- Address -->
          ${branch.address ? `
            <div class="text-xs text-slate-300 flex items-start gap-1.5 mt-2 leading-relaxed">
              <i class="fa-solid fa-map-pin text-slate-500 text-xs mt-0.5 shrink-0"></i>
              <span>${escapeHtml(branch.address)}</span>
            </div>
          ` : ''}

          <!-- Served Areas (for AI context) -->
          ${servedChips ? `
            <div class="mt-2.5">
              <div class="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
                <i class="fa-solid fa-bullseye text-rose-400/80"></i>
                <span>يخدم مناطق:</span>
              </div>
              <div class="flex flex-wrap gap-1">
                ${servedChips}
              </div>
            </div>
          ` : ''}

          <!-- Phone & Working hours / Notes -->
          ${(branch.phone || branch.notes) ? `
            <div class="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-col gap-1 text-[11px] text-slate-400">
              ${branch.phone ? `
                <div class="flex items-center gap-1.5 font-mono">
                  <i class="fa-solid fa-phone text-slate-500 text-[10px]"></i>
                  <span>${escapeHtml(branch.phone)}</span>
                </div>
              ` : ''}
              ${branch.notes ? `
                <div class="flex items-center gap-1.5 text-slate-400">
                  <i class="fa-solid fa-circle-info text-slate-500 text-[10px]"></i>
                  <span>${escapeHtml(branch.notes)}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>

        <!-- Google Maps Link Button -->
        <div class="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
          ${isExternal ? `
            <a href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer"
              class="w-full py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-300 border border-slate-700 hover:border-emerald-500/40 text-xs font-bold transition-all flex items-center justify-center gap-2">
              <i class="fa-solid fa-map-location-dot"></i>
              <span>فتح لوكيشن Google Maps</span>
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
          ` : `
            <span class="text-[11px] text-slate-500 italic">لا يوجد رابط لوكيشن مسجل</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function filterBranchesList() {
  const query = (document.getElementById('branches-search-input')?.value || '').trim().toLowerCase();
  if (!query) {
    renderBranches(branches);
    return;
  }
  const filtered = branches.filter(b => {
    return (
      (b.name && b.name.toLowerCase().includes(query)) ||
      (b.city && b.city.toLowerCase().includes(query)) ||
      (b.governorate && b.governorate.toLowerCase().includes(query)) ||
      (b.servedAreas && b.servedAreas.toLowerCase().includes(query)) ||
      (b.address && b.address.toLowerCase().includes(query))
    );
  });
  renderBranches(filtered);
}

function autoSuggestServedAreas() {
  const city = (document.getElementById('branch-city')?.value || '').trim();
  const gov = (document.getElementById('branch-governorate')?.value || '').trim();
  const name = (document.getElementById('branch-name')?.value || '').trim();
  const combined = (city + ' ' + gov + ' ' + name).toLowerCase();

  const presets = [
    { key: 'منصورة|دقهلية', val: 'المنصورة، طلخا، ميت غمر، السنبلاوين، دكرنس، بلقاس، شربين، دمياط، كفر الشيخ' },
    { key: 'قاهرة|جيزة|فيصل|هرم|فجالة', val: 'القاهرة، الجيزة، فيصل، الهرم، وسط البلد، الفجالة، المعادي، مدينة نصر، أكتوبر، زايد' },
    { key: 'عاشر|رمضان|شرقية|بلبيس|زقازيق', val: 'العاشر من رمضان، بلبيس، الزقازيق، فاقوس، أبو حماد، ههيا، العبور، بدر، الشروق' },
    { key: 'إسماعيلية|اسماعيلية|قناة|سويس|بورسعيد', val: 'الإسماعيلية، السويس، بورسعيد، القنطرة، فايد، مدن القناة' },
    { key: 'إسكندرية|اسكندرية|سموحة|عجمي|ساحل', val: 'الإسكندرية، سموحة، سيدي جابر، ميامي، العجمي، برج العرب، الساحل الشمالي' },
    { key: 'طنطا|غربية|محلة', val: 'طنطا، المحلة الكبرى، كفر الزيات، زفتى، سمنود، الغربية' },
    { key: 'منوفية|شبين|سادات', val: 'شبين الكوم، مدينة السادات، قويسنا، أشمون، بركة السبع، المنوفية' }
  ];

  let matchedVal = '';
  for (const p of presets) {
    const regex = new RegExp(p.key, 'i');
    if (regex.test(combined)) {
      matchedVal = p.val;
      break;
    }
  }

  const servedInput = document.getElementById('branch-served');
  if (servedInput) {
    if (matchedVal) {
      servedInput.value = matchedVal;
    } else if (city || gov) {
      servedInput.value = `${city}، ${gov} والمناطق المجاورة لها بالكامل`;
    } else {
      alert('يرجى كتابة اسم المدينة أو المحافظة أولاً ليستنتج الذكاء الاصطناعي المناطق المحيطة بها تلقائياً ✨');
    }
  }
}

function resetBranchForm() {
  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) el.value = val;
  };

  setVal('branch-id', '');
  setVal('branch-name', '');
  setVal('branch-city', '');
  setVal('branch-governorate', '');
  setVal('branch-served', '');
  setVal('branch-map-link', '');
  setVal('branch-address', '');
  setVal('branch-phone', '01144505575');
  setVal('branch-notes', '');

  const titleEl = document.getElementById('branch-form-title');
  if (titleEl) titleEl.textContent = 'إضافة معرض / فرع جديد';

  const submitTextEl = document.getElementById('branch-submit-text');
  if (submitTextEl) submitTextEl.textContent = 'حفظ وتحديث المعرض';

  const cancelBtn = document.getElementById('branch-form-cancel-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editBranch(id) {
  const branch = branches.find(b => b.id === id);
  if (!branch) return;

  const setVal = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) el.value = val;
  };

  setVal('branch-id', branch.id);
  setVal('branch-name', branch.name || '');
  setVal('branch-city', branch.city || '');
  setVal('branch-governorate', branch.governorate || '');
  setVal('branch-served', branch.servedAreas || '');
  setVal('branch-map-link', branch.mapLink || '');
  setVal('branch-address', branch.address || '');
  setVal('branch-phone', branch.phone || '');
  setVal('branch-notes', branch.notes || '');

  const titleEl = document.getElementById('branch-form-title');
  if (titleEl) titleEl.textContent = `تعديل: ${branch.name}`;

  const submitTextEl = document.getElementById('branch-submit-text');
  if (submitTextEl) submitTextEl.textContent = 'حفظ التعديلات';

  const cancelBtn = document.getElementById('branch-form-cancel-btn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  const card = document.getElementById('branch-form-card');
  if (card) card.scrollIntoView({ behavior: 'smooth' });
}

async function submitBranchForm() {
  const id = document.getElementById('branch-id')?.value?.trim() || '';
  const name = document.getElementById('branch-name')?.value?.trim() || '';
  const city = document.getElementById('branch-city')?.value?.trim() || '';
  const governorate = document.getElementById('branch-governorate')?.value?.trim() || '';
  const servedAreas = document.getElementById('branch-served')?.value?.trim() || '';
  const mapLink = document.getElementById('branch-map-link')?.value?.trim() || '';
  const address = document.getElementById('branch-address')?.value?.trim() || '';
  const phone = document.getElementById('branch-phone')?.value?.trim() || '';
  const notes = document.getElementById('branch-notes')?.value?.trim() || '';

  if (!name) {
    alert('يرجى كتابة اسم المعرض أو الفرع.');
    return;
  }
  if (!mapLink) {
    alert('يرجى إدخال رابط اللوكيشن من خرائط جوجل (Google Maps Link).');
    return;
  }

  const saveBtn = document.getElementById('btn-save-branch');
  const submitText = document.getElementById('branch-submit-text');
  const submitIcon = saveBtn ? saveBtn.querySelector('i') : null;

  if (saveBtn) saveBtn.disabled = true;
  if (submitText) submitText.textContent = 'جاري الحفظ...';
  if (submitIcon) submitIcon.className = 'fa-solid fa-spinner fa-spin';

  try {
    const res = await fetch('/api/branches/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id || undefined,
        name,
        city,
        governorate,
        servedAreas,
        mapLink,
        address,
        phone,
        notes
      })
    });
    const data = await res.json();
    if (data.success) {
      branches = data.branches || [];
      renderBranches(branches);
      updateBranchBadges();
      resetBranchForm();
      alert('تم حفظ بيانات المعرض وتحديث ذاكرة الذكاء الاصطناعي بنجاح! ✅');
    } else {
      alert('خطأ أثناء الحفظ: ' + (data.error || 'فشلت العملية'));
    }
  } catch (err) {
    alert('حدث خطأ أثناء حفظ المعرض: ' + err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (submitIcon) submitIcon.className = 'fa-solid fa-floppy-disk';
    if (submitText) {
      const isEditing = Boolean(document.getElementById('branch-id')?.value);
      submitText.textContent = isEditing ? 'حفظ التعديلات' : 'حفظ وتحديث المعرض';
    }
  }
}

async function deleteBranch(id, name) {
  if (!confirm(`هل أنت متأكد من حذف فرع [${name}]؟`)) return;

  try {
    const res = await fetch(`/api/branches/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      branches = data.branches || [];
      renderBranches(branches);
      updateBranchBadges();
      if (document.getElementById('branch-id')?.value === id) {
        resetBranchForm();
      }
    } else {
      alert('خطأ أثناء الحذف: ' + (data.error || 'فشلت العملية'));
    }
  } catch (err) {
    alert('حدث خطأ أثناء حذف المعرض: ' + err.message);
  }
}

function setBranchTestQuery(text) {
  const input = document.getElementById('branch-test-input');
  if (input) {
    input.value = text;
    testBranchRecommendation();
  }
}

async function testBranchRecommendation() {
  const input = document.getElementById('branch-test-input');
  const query = (input?.value || '').trim() || 'أنا في المنصورة وعاوز أشوف العلب';
  if (input) input.value = query;

  const btn = document.getElementById('btn-test-branch');
  const oldBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>جاري التحليل...</span>';
  }

  const outputContainer = document.getElementById('branch-test-output');
  const matchedNameEl = document.getElementById('branch-test-matched-name');
  const matchedLinkEl = document.getElementById('branch-test-matched-link');
  const replyTextEl = document.getElementById('branch-test-reply-text');

  try {
    const res = await fetch('/api/branches/test-recommendation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query })
    });
    const data = await res.json();
    if (data.success) {
      if (outputContainer) outputContainer.classList.remove('hidden');
      if (matchedNameEl) matchedNameEl.textContent = data.closestBranch?.name || 'المصنع الرئيسي';
      if (matchedLinkEl) {
        matchedLinkEl.href = data.closestBranch?.mapLink || '#';
      }
      if (replyTextEl) {
        replyTextEl.textContent = data.reply || data.simulatedReply || 'لا يوجد رد';
      }
    } else {
      alert('خطأ في المحاكاة: ' + (data.error || 'تعذر الفحص'));
    }
  } catch (err) {
    alert('حدث خطأ أثناء فحص التوصية: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldBtnHtml;
    }
  }
}

// ============================================================================
// AI LEAD FINDER & 14-DAY RE-ENGAGEMENT PIPELINE
// ============================================================================

let leadSearchSource = 'web_search'; // 'web_search' (Firecrawl AI) or 'map_osm'
let leadGovMode = 'random';
let generatedLeads = [];
let followup14dLeads = [];

async function checkFirecrawlStatus() {
  const dot = document.getElementById('fc-status-dot');
  const text = document.getElementById('fc-status-text');
  try {
    const res = await fetch('/api/leads/firecrawl-status');
    const data = await res.json();
    if (data.configured) {
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
      if (text) text.textContent = 'Firecrawl: جاهز ومتصل ⚡';
    } else {
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400';
      if (text) text.textContent = 'Firecrawl: يرجى إضافة المفتاح ⚠️';
    }
  } catch (e) {
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-rose-400';
    if (text) text.textContent = 'Firecrawl: غير متصل';
  }
}

function setLeadSource(source) {
  leadSearchSource = source;
  const btnFc = document.getElementById('btn-source-firecrawl');
  const btnOsm = document.getElementById('btn-source-osm');
  const webLoc = document.getElementById('web-location-box');
  const webAdv = document.getElementById('web-advanced-box');
  const mapGeo = document.getElementById('map-geo-box');
  const customGovs = document.getElementById('custom-govs-container');
  const attrText = document.getElementById('leads-attribution-text');

  if (source === 'web_search') {
    if (btnFc) btnFc.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2 transition-all';
    if (btnOsm) btnOsm.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 border border-slate-700 hover:text-white flex items-center gap-2 transition-all';
    if (webLoc) webLoc.classList.remove('hidden');
    if (webAdv) webAdv.classList.remove('hidden');
    if (mapGeo) mapGeo.classList.add('hidden');
    if (customGovs) customGovs.classList.add('hidden');
    if (attrText) attrText.textContent = 'بيانات مستخرجة ومحققة بالذكاء الاصطناعي بواسطة Firecrawl & Gemini AI';
  } else {
    if (btnFc) btnFc.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 border border-slate-700 hover:text-white flex items-center gap-2 transition-all';
    if (btnOsm) btnOsm.className = 'px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-2 transition-all';
    if (webLoc) webLoc.classList.add('hidden');
    if (webAdv) webAdv.classList.add('hidden');
    if (mapGeo) mapGeo.classList.remove('hidden');
    if (leadGovMode === 'custom' && customGovs) customGovs.classList.remove('hidden');
    if (attrText) attrText.textContent = 'بيانات الخرائط مقدمة من مساهمي © OpenStreetMap';
  }
}

function initLeadsTab() {
  checkFirecrawlStatus();
  setLeadSource(leadSearchSource);
  renderGovCheckboxes();
  load14DayFollowups();
}

function setGovMode(mode) {
  leadGovMode = mode;
  const btnRandom = document.getElementById('btn-gov-random');
  const btnCustom = document.getElementById('btn-gov-custom');
  const customContainer = document.getElementById('custom-govs-container');

  if (mode === 'random') {
    if (btnRandom) {
      btnRandom.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center gap-1.5 transition-all';
    }
    if (btnCustom) {
      btnCustom.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 border border-slate-700 hover:text-white flex items-center justify-center gap-1.5 transition-all';
    }
    if (customContainer) customContainer.classList.add('hidden');
  } else {
    if (btnRandom) {
      btnRandom.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-slate-900 text-slate-400 border border-slate-700 hover:text-white flex items-center justify-center gap-1.5 transition-all';
    }
    if (btnCustom) {
      btnCustom.className = 'flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center gap-1.5 transition-all';
    }
    if (customContainer) customContainer.classList.remove('hidden');
    renderGovCheckboxes();
  }
}

function selectAllGovs(checked) {
  document.querySelectorAll('.gov-checkbox').forEach(cb => {
    cb.checked = checked;
  });
}

function renderGovCheckboxes() {
  const container = document.getElementById('govs-checkboxes-grid');
  if (!container || container.children.length > 0) return;

  const ALL_GOVERNORATES = [
    'القاهرة', 'الجيزة', 'الشرقية', 'الإسكندرية', 'الدقهلية',
    'القليوبية', 'الغربية', 'المنوفية', 'البحيرة', 'كفر الشيخ',
    'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم',
    'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا', 'الأقصر', 'أسوان'
  ];

  const defaultChecked = ['القاهرة', 'الجيزة', 'الشرقية', 'الإسكندرية', 'الدقهلية'];

  container.innerHTML = ALL_GOVERNORATES.map(gov => {
    const isChecked = defaultChecked.includes(gov);
    return `
      <label class="flex items-center gap-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer select-none text-xs text-slate-300">
        <input type="checkbox" value="${gov}" class="gov-checkbox w-3.5 h-3.5 accent-amber-500 rounded" ${isChecked ? 'checked' : ''}>
        <span>${gov}</span>
      </label>
    `;
  }).join('');
}

function scrollTo14DaySection() {
  const el = document.getElementById('section-14days-followup');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function startAILeadSearch() {
  const catEl = document.getElementById('leads-category');
  const countEl = document.getElementById('leads-count');
  const loaderEl = document.getElementById('leads-search-loader');
  const resultsCardEl = document.getElementById('leads-results-card');
  const btnStart = document.getElementById('btn-start-lead-search');
  const loaderStatus = document.getElementById('leads-loader-status');

  const category = catEl ? catEl.value : 'all';
  const count = countEl ? parseInt(countEl.value, 10) || 10 : 10;

  if (loaderEl) loaderEl.classList.remove('hidden');
  if (resultsCardEl) resultsCardEl.classList.add('hidden');
  if (btnStart) {
    btnStart.disabled = true;
    btnStart.classList.add('opacity-60', 'cursor-not-allowed');
  }

  let url = '/api/leads/find';
  let payload = {};

  if (leadSearchSource === 'web_search') {
    if (loaderStatus) loaderStatus.textContent = 'جاري البحث عبر Firecrawl وقراءة صفحات المواقع واستخراج الشركات...';
    const cityInput = document.getElementById('leads-city-input');
    const keywordsInput = document.getElementById('leads-keywords-input');
    const maxScrapesEl = document.getElementById('leads-max-scrapes');
    const verifyWaEl = document.getElementById('leads-verify-wa');

    url = '/api/leads/firecrawl-search';
    payload = {
      category,
      city: cityInput ? cityInput.value.trim() : 'العاشر من رمضان',
      keywords: keywordsInput ? keywordsInput.value.trim() : '',
      count,
      maxScrapes: maxScrapesEl ? parseInt(maxScrapesEl.value, 10) || 4 : 4,
      verifyWhatsApp: Boolean(verifyWaEl && verifyWaEl.checked),
      allowDuplicates: false
    };
  } else {
    if (loaderStatus) loaderStatus.textContent = 'جاري استخراج الأماكن من خريطة OpenStreetMap...';
    let selectedGovs = [];
    if (leadGovMode === 'custom') {
      const checked = document.querySelectorAll('.gov-checkbox:checked');
      checked.forEach(cb => selectedGovs.push(cb.value));
      if (selectedGovs.length === 0) {
        alert('يرجى اختيار محافظة واحدة على الأقل في وضع التحديد الجغرافي');
        if (loaderEl) loaderEl.classList.add('hidden');
        if (btnStart) {
          btnStart.disabled = false;
          btnStart.classList.remove('opacity-60', 'cursor-not-allowed');
        }
        return;
      }
    }
    url = '/api/leads/find';
    payload = {
      source: 'map_osm',
      category,
      count,
      governorates: selectedGovs,
      isRandom: leadGovMode === 'random',
      allowDuplicates: false
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      generatedLeads = data.leads || [];
      const countBadge = document.getElementById('leads-count-badge');
      if (countBadge) countBadge.textContent = `${data.count} عميل مؤهل`;

      const dupText = document.getElementById('leads-dup-filtered-text');
      if (dupText) {
        dupText.textContent = `تم استبعاد ${data.duplicatesFiltered || 0} أرقام مكررة أو مسجلة سابقاً 🛡️`;
      }

      renderGeneratedLeadsTable(generatedLeads);
      if (resultsCardEl) {
        resultsCardEl.classList.remove('hidden');
        resultsCardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      alert('تعذر استخراج البيانات: ' + (data.error || 'حدث خطأ في البحث'));
    }
  } catch (err) {
    alert('خطأ أثناء جلب البيانات: ' + err.message);
  } finally {
    if (loaderEl) loaderEl.classList.add('hidden');
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

function renderGeneratedLeadsTable(leads) {
  const tbody = document.getElementById('leads-table-body');
  if (!tbody) return;

  if (!leads || leads.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="py-8 text-center text-slate-400">
          لم يتم العثور على أرقام جديدة تطابق شروط البحث
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = leads.map((lead, index) => {
    const cleanPhone = (lead.phone || '').replace(/\D/g, '');
    const isMobile = lead.phoneType === 'mobile' || /^201[0125]\d{8}$/.test(cleanPhone);
    const waLink = `https://wa.me/${cleanPhone}`;
    const siteUrl = lead.website || lead.sourceUrl;
    const siteDomain = siteUrl ? siteUrl.replace(/^https?:\/\//i, '').split('/')[0] : '';
    const siteTitle = lead.sourceTitle || siteDomain || 'المصدر';

    let verificationBadge = '';
    if (lead.whatsappVerified === true) {
      verificationBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
          <i class="fa-solid fa-circle-check text-[10px]"></i>
          <span>واتساب مؤكد 100%</span>
        </span>
      `;
    } else if (isMobile) {
      verificationBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 whitespace-nowrap">
          <i class="fa-solid fa-globe text-[10px]"></i>
          <span>ويب (موبايل)</span>
        </span>
      `;
    } else if (lead.phoneType === 'landline') {
      verificationBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600 whitespace-nowrap">
          <i class="fa-solid fa-phone text-[10px]"></i>
          <span>ويب (أرضي)</span>
        </span>
      `;
    } else {
      verificationBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 whitespace-nowrap">
          <i class="fa-solid fa-triangle-exclamation text-[10px]"></i>
          <span>غير مؤكد</span>
        </span>
      `;
    }

    return `
      <tr class="hover:bg-slate-800/60 transition-colors">
        <td class="p-3 text-center font-bold text-slate-400">${index + 1}</td>
        <td class="p-3">
          <div class="font-bold text-white text-xs">${escapeHtml(lead.company || lead.name || 'مكان غير معروف')}</div>
          ${lead.address ? `<div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(lead.address)}</div>` : ''}
          ${lead.evidence ? `<div class="text-[10px] text-slate-500 italic truncate max-w-xs mt-0.5" title="${escapeHtml(lead.evidence)}">«${escapeHtml(lead.evidence)}»</div>` : ''}
        </td>
        <td class="p-3 text-xs">
          <span class="text-amber-300 font-semibold">${escapeHtml(lead.governorate || '')}</span>
          ${lead.city ? `<span class="text-slate-400 text-[11px] block">${escapeHtml(lead.city)}</span>` : ''}
        </td>
        <td class="p-3 text-xs">
          <span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
            ${escapeHtml(lead.category || '')}
          </span>
        </td>
        <td class="p-3">
          ${isMobile ? `
            <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="font-mono text-emerald-400 hover:text-emerald-300 dir-ltr inline-flex items-center gap-1 font-semibold text-xs">
              <i class="fa-brands fa-whatsapp text-sm"></i>
              <span>${escapeHtml(lead.phone || '')}</span>
            </a>
            <div class="mt-0.5"><span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-medium">موبايل 📱</span></div>
          ` : `
            <span class="font-mono text-slate-300 dir-ltr inline-flex items-center gap-1 text-xs">
              <i class="fa-solid fa-phone text-slate-400 text-xs"></i>
              <span>${escapeHtml(lead.phone || '')}</span>
            </span>
            <div class="mt-0.5"><span class="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 font-medium">أرضي ☎️</span></div>
          `}
        </td>
        <td class="p-3 text-xs">
          ${siteUrl ? `
            <a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 text-[11px] font-medium max-w-[150px] truncate underline decoration-amber-400/40" title="${escapeHtml(siteTitle)} (${escapeHtml(siteUrl)})">
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
              <span class="truncate">${escapeHtml(siteTitle)}</span>
            </a>
          ` : (lead.source === 'osm_overpass' ? `
            <span class="text-slate-500 text-[10px] inline-flex items-center gap-1">
              <i class="fa-solid fa-map-location-dot"></i>
              <span>خريطة OSM</span>
            </span>
          ` : `
            <span class="text-slate-500 text-[10px]">-</span>
          `)}
        </td>
        <td class="p-3 text-slate-300 text-[11px] max-w-xs leading-snug">
          ${escapeHtml(lead.suggestedPackaging || 'عبوات ومستلزمات عامة')}
        </td>
        <td class="p-3 text-center">
          ${verificationBadge}
        </td>
      </tr>
    `;
  }).join('');
}

function filterGeneratedLeadsTable() {
  const input = document.getElementById('leads-filter-input');
  const mobileOnly = document.getElementById('leads-filter-mobile-only')?.checked;
  const query = (input?.value || '').trim().toLowerCase();

  let filtered = generatedLeads || [];

  if (mobileOnly) {
    filtered = filtered.filter(lead => {
      const clean = (lead.phone || '').replace(/\D/g, '');
      return lead.phoneType === 'mobile' || /^201[0125]\d{8}$/.test(clean);
    });
  }

  if (query) {
    filtered = filtered.filter(lead => {
      const text = `${lead.company || ''} ${lead.name || ''} ${lead.contactPerson || ''} ${lead.governorate || ''} ${lead.city || ''} ${lead.category || ''} ${lead.phone || ''} ${lead.website || ''} ${lead.sourceUrl || ''} ${lead.sourceTitle || ''} ${lead.suggestedPackaging || ''} ${lead.evidence || ''}`.toLowerCase();
      return text.includes(query);
    });
  }

  renderGeneratedLeadsTable(filtered);
}

async function downloadLeadsExcel() {
  if (!generatedLeads || generatedLeads.length === 0) {
    alert('لا توجد بيانات مستخرجة لتنزيلها حالياً');
    return;
  }
  const btn = document.getElementById('btn-download-leads');
  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>جاري تجهيز الإكسيل...</span>';
  }
  try {
    const res = await fetch('/api/leads/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: generatedLeads })
    });
    if (!res.ok) {
      throw new Error('فشل تنزيل ملف الإكسيل');
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `leads_hakim_group_${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (err) {
    alert('حدث خطأ أثناء تنزيل الإكسيل: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }
}

async function importLeadsToCampaign() {
  if (!generatedLeads || generatedLeads.length === 0) {
    alert('لا توجد بيانات مستخرجة لبدء الحملة عليها');
    return;
  }
  const count = generatedLeads.length;
  if (!confirm(`هل تريد استيراد ${count} عميل مباشرة إلى جدول الحملة لبدء مراسلتهم؟\n(السيستم سيضمن أوتوماتيكياً عدم إدراج أي رقم تم مراسلته سابقاً)`)) {
    return;
  }
  const btn = document.getElementById('btn-import-campaign');
  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>جاري الإدراج في الحملة...</span>';
  }
  try {
    const res = await fetch('/api/leads/import-to-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: generatedLeads })
    });
    const data = await res.json();
    if (data.success) {
      alert(`✅ تم استيراد ${data.addedCount} عميل جديد بنجاح إلى الحملة!${data.skippedDuplicates > 0 ? `\n(تم استبعاد ${data.skippedDuplicates} رقم مكرر تلقائياً لمنع إزعاجهم)` : ''}\nسيتم تحويلك الآن إلى صفحة الحملة.`);
      await loadContacts();
      switchTab('tab-campaign');
    } else {
      alert('خطأ في استيراد العملاء: ' + (data.error || 'تعذر الإكمال'));
    }
  } catch (err) {
    alert('حدث خطأ أثناء الاستيراد: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
    }
  }
}

async function load14DayFollowups() {
  const badge = document.getElementById('followup-14d-badge');
  const tbody = document.getElementById('followup-14d-body');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin text-purple-400 text-base mb-2 block"></i>جاري فحص وتصفية سجلات العملاء التي مر عليها 14 يوماً...</td></tr>`;
  }
  try {
    const res = await fetch('/api/leads/followup-14days');
    const data = await res.json();
    if (data.success) {
      followup14dLeads = data.candidates || [];
      if (badge) badge.textContent = `${followup14dLeads.length} عميل مؤهل`;
      render14DayFollowupsTable(followup14dLeads);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-400 text-xs">تعذر تحميل بيانات المراجعة: ${data.error || ''}</td></tr>`;
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-rose-400 text-xs">خطأ في الاتصال بالخادم: ${err.message}</td></tr>`;
  }
}

function render14DayFollowupsTable(candidates) {
  const tbody = document.getElementById('followup-14d-body');
  if (!tbody) return;

  if (!candidates || candidates.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-10 text-center text-slate-400">
          <i class="fa-solid fa-circle-check text-emerald-400 text-3xl mb-2 block"></i>
          <p class="font-bold text-slate-300 text-sm">ممتاز! لا يوجد عملاء مستحقين لمراجعة الأسبوعين حالياً.</p>
          <p class="text-xs text-slate-500 mt-1">العملاء الذين ردوا عليك وتفاعلوا، ستظهر أرقامهم هنا تلقائياً بمجرد مرور 14 يوماً على آخر رسالة دون أي تكرار عشوائي.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = candidates.map(c => `
    <tr class="hover:bg-slate-800/60 transition-colors">
      <td class="p-3">
        <div class="font-bold text-white text-xs">${escapeHtml(c.name || 'عميل')}</div>
        <div class="text-[11px] text-slate-400">${escapeHtml(c.company || '')} ${c.city ? `(${escapeHtml(c.city)})` : ''}</div>
      </td>
      <td class="p-3">
        <span class="font-mono text-emerald-400 dir-ltr text-xs font-semibold">${escapeHtml(c.phone)}</span>
      </td>
      <td class="p-3">
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
          <i class="fa-regular fa-clock"></i>
          <span>${c.daysPassed} يوم مضى</span>
        </span>
        <div class="text-[10px] text-slate-500 mt-0.5">${c.lastInteractionDate || ''}</div>
      </td>
      <td class="p-3 max-w-xs">
        <div class="text-[11px] text-slate-300 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 leading-relaxed font-sans line-clamp-3" title="${escapeHtml(c.suggestedReminderText || '')}">
          ${escapeHtml(c.suggestedReminderText || '')}
        </div>
      </td>
      <td class="p-3 text-center">
        <button type="button" onclick="send14DayReminder('${c.phone}', '${escapeHtml(c.name || '')}')"
          class="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 transition-all flex items-center gap-1.5 mx-auto shadow-md shadow-purple-600/30">
          <i class="fa-brands fa-whatsapp text-emerald-300"></i>
          <span>إرسال التذكير</span>
        </button>
      </td>
    </tr>
  `).join('');
}

async function send14DayReminder(phone, name) {
  if (!confirm(`هل أنت متأكد من إرسال رسالة تذكير احترافية للعميل (${name || phone})؟\n(الرسالة خالية تماماً من عروض الأسعار والوعود بالشحن حفاظاً على قواعد المصنع)`)) {
    return;
  }
  try {
    const res = await fetch('/api/leads/send-14day-followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.success) {
      alert('✅ تم إرسال رسالة التذكير بنجاح عبر الواتساب!');
      await load14DayFollowups();
      await loadChats();
    } else {
      alert('فشل إرسال التذكير: ' + (data.error || 'تأكد من اتصال الواتساب'));
    }
  } catch (err) {
    alert('حدث خطأ أثناء إرسال التذكير: ' + err.message);
  }
}

// Run app init on load
initApp();
