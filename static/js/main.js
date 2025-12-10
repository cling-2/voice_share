document.addEventListener("DOMContentLoaded", () => {
  initSliderVerification();
  initGlobalHostControls();
  initChatControls(); // 【新增】初始化聊天拦截
  initRoomSync();
  initMusicAutofill();
});

// --- 1. 聊天发送逻辑 (拦截表单，防止刷新) ---
function initChatControls() {
  const chatForm = document.querySelector('.chat-form');
  if (!chatForm) return;

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // 阻止默认提交（防止页面刷新！）

    const input = chatForm.querySelector('input[name="content"]');
    const btn = chatForm.querySelector('.send-btn');
    const content = input.value.trim();
    if (!content) return;

    // 视觉反馈：禁用按钮防止重复发送
    btn.disabled = true;
    btn.style.opacity = '0.5';

    const formData = new FormData(chatForm);

    try {
      const response = await fetch(chatForm.action, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        // 发送成功：清空输入框
        input.value = '';
        // 立即触发一次同步，让自己的消息马上显示出来
        if (window.manualRefreshState) await window.manualRefreshState();
        // 滚动到底部 (可选，updateChatLog 里通常会处理)
        const chatLog = document.querySelector("#chat-log");
        if(chatLog) chatLog.scrollTop = chatLog.scrollHeight;
      } else {
        console.error("消息发送失败");
      }
    } catch (err) {
      console.error("网络错误", err);
    } finally {
      // 恢复按钮
      btn.disabled = false;
      btn.style.opacity = '1';
      // 保持输入框聚焦，方便继续打字
      input.focus();
    }
  });
}

// --- 2. 房主控制逻辑 ---
function initGlobalHostControls() {
  document.body.addEventListener('click', async (e) => {
    const btn = e.target.closest('.control-btn');
    if (!btn) return;
    e.preventDefault();

    if (!window.roomConfig || !window.roomConfig.toggleUrl) return;

    const originalOpacity = btn.style.opacity;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'wait';

    const formData = new FormData();
    const action = btn.value || btn.getAttribute('value');
    formData.append('action', action);

    const form = btn.closest('form');
    if (form) {
        const csrf = form.querySelector('input[name="csrf_token"]');
        if (csrf) formData.append('csrf_token', csrf.value);
    }

    const audio = document.querySelector('#room-audio');
    let pos = 0;
    if (audio && !isNaN(audio.currentTime)) {
      pos = audio.currentTime;
    }
    formData.append('position', pos);

    try {
      const response = await fetch(window.roomConfig.toggleUrl, {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        if (window.manualRefreshState) await window.manualRefreshState();
      }
    } catch (err) {
      console.error("网络错误:", err);
    } finally {
      if (btn) {
        btn.style.opacity = originalOpacity || '1';
        btn.style.cursor = 'pointer';
      }
    }
  });
}

// --- 3. 房间同步逻辑 ---
function initRoomSync() {
  if (!window.roomConfig) return;
  const { stateUrl, audioSelector, isOwner } = window.roomConfig;
  const audio = document.querySelector(audioSelector);

  const label = document.querySelector("#state-label");
  const trackLabel = document.querySelector("#current-track-label");
  const statusIndicator = document.querySelector(".status-indicator");
  const statusDot = document.querySelector(".status-dot");
  const hostBtnWrapper = document.querySelector("#host-btn-wrapper");
  const chatLog = document.querySelector("#chat-log");

  const progressFill = document.querySelector("#progress-fill");
  const timeCurrent = document.querySelector("#time-current");
  const timeDuration = document.querySelector("#time-duration");
  const vinylWrapper = document.querySelector('.vinyl-wrapper');

  if (audio) {
    audio.addEventListener("timeupdate", () => {
      const current = audio.currentTime || 0;
      const duration = audio.duration || 0;
      if (timeCurrent) timeCurrent.textContent = formatTime(current);
      if (timeDuration && duration > 0 && duration !== Infinity) {
          timeDuration.textContent = formatTime(duration);
      }
      if (progressFill && duration > 0 && duration !== Infinity) {
        const percent = (current / duration) * 100;
        progressFill.style.width = `${percent}%`;
      }
    });
    audio.addEventListener("loadedmetadata", () => {
      if (timeDuration && audio.duration && audio.duration !== Infinity) {
        timeDuration.textContent = formatTime(audio.duration);
      }
    });
  }

  async function refreshState() {
    try {
      const response = await fetch(stateUrl);
      if (!response.ok) return;
      const state = await response.json();

      if (label) label.textContent = state.playback_status === "playing" ? "播放中" : "已暂停";
      if (statusDot) {
        statusDot.classList.remove('playing', 'paused');
        statusDot.classList.add(state.playback_status);
      }
      if (trackLabel) {
        const newTitle = state.current_track_name || "等待播放...";
        if (trackLabel.textContent.trim() !== newTitle) trackLabel.textContent = newTitle;
      }
      if (statusIndicator) {
        statusIndicator.textContent = state.is_active ? "正在营业" : "已打烊";
        statusIndicator.className = `status-indicator ${state.is_active ? 'active' : 'closed'}`;
      }

      if (hostBtnWrapper) {
          const currentBtn = hostBtnWrapper.querySelector('.control-btn');
          if (currentBtn) {
              const btnAction = currentBtn.value || currentBtn.getAttribute('value');
              if (state.playback_status === 'playing' && btnAction === 'play') {
                  hostBtnWrapper.innerHTML = `
                    <button class="control-btn pause" name="action" value="pause" title="全员暂停">
                      <i class="ri-pause-mini-fill"></i> 暂停全员
                    </button>`;
              } else if (state.playback_status !== 'playing' && btnAction === 'pause') {
                  hostBtnWrapper.innerHTML = `
                    <button class="control-btn play" name="action" value="play" title="全员播放">
                      <i class="ri-play-mini-fill"></i> 播放全员
                    </button>`;
              }
          }
      }

      if (audio && state.is_active) {
          if (state.current_track_file) {
            const targetSrc = `/static/uploads/music/${state.current_track_file}`;
            const currentSrcPath = decodeURIComponent(audio.src).split('/static/uploads/music/')[1];

            if (currentSrcPath !== state.current_track_file) {
              audio.src = targetSrc;
              if (state.current_position > 0) audio.currentTime = state.current_position;
              try {
                  await audio.load();
                  if (state.playback_status === "playing") audio.play().catch(() => {});
              } catch (e) { console.error(e); }
            }

            if (state.current_position !== undefined && state.current_position !== null) {
                 const diff = Math.abs(audio.currentTime - state.current_position);
                 if (state.playback_status === "paused") {
                     if (diff > 0.5) audio.currentTime = state.current_position;
                 }
                 else if (state.playback_status === "playing") {
                     if (isOwner && !audio.paused) {
                         if (diff > 5) audio.currentTime = state.current_position;
                     } else {
                         if (diff > 2) audio.currentTime = state.current_position;
                     }
                 }
            }

            if (state.playback_status === "playing") {
                if (audio.paused) audio.play().catch(() => {});
                if (vinylWrapper) vinylWrapper.classList.add('spinning');
            } else {
                if (!audio.paused) audio.pause();
                if (vinylWrapper) vinylWrapper.classList.remove('spinning');
            }
          }
      }

      // 【关键】处理聊天记录同步
      if (chatLog && state.messages) updateChatLog(chatLog, state.messages);

    } catch (error) {
      console.error("Sync error:", error);
    }
  }

  window.manualRefreshState = refreshState;
  refreshState();
  setInterval(refreshState, 2000);
}

// --- 4. 聊天渲染 (保持不变) ---
function updateChatLog(container, messages) {
    const existingItems = container.querySelectorAll('.chat-bubble-row');
    const existingIds = new Set();
    existingItems.forEach(el => {
        if (el.dataset.id) existingIds.add(parseInt(el.dataset.id));
    });
    let hasNew = false;
    const noMsg = container.querySelector('.no-msg');

    messages.forEach(msg => {
        if (!existingIds.has(msg.id)) {
            if (noMsg) noMsg.remove();
            const html = `
                <div class="chat-bubble-row" data-id="${msg.id}">
                    <img src="${msg.author_avatar}" class="chat-avatar-sm" />
                    <div class="chat-content-wrap">
                        <div class="chat-meta">
                            <span class="chat-name">${escapeHtml(msg.author_name)}</span>
                            <span class="chat-time">${msg.created_at}</span>
                        </div>
                        <div class="chat-bubble">${escapeHtml(msg.content)}</div>
                    </div>
                </div>`;
            container.insertAdjacentHTML('beforeend', html);
            hasNew = true;
        }
    });
    if (hasNew) container.scrollTop = container.scrollHeight;
}

// --- 5. 辅助函数 ---
function initSliderVerification() {
  document.querySelectorAll(".slider-verify").forEach((wrapper) => {
    const thumb = wrapper.querySelector(".slider-thumb");
    const track = wrapper.querySelector(".slider-track");
    const tip = wrapper.querySelector(".slider-tip");
    const hiddenInputId = wrapper.dataset.target;
    const hiddenInput = document.getElementById(hiddenInputId);
    if (!thumb || !track || !hiddenInput) return;
    let isDragging = false;
    let startX = 0; let currentX = 0;
    const maxOffset = track.offsetWidth - thumb.offsetWidth - 8;
    function setVerified() { hiddenInput.value = "verified"; tip.textContent = "验证完成"; track.classList.add("verified"); }
    function resetSlider() { hiddenInput.value = ""; thumb.style.transform = "translateX(0px)"; tip.textContent = "拖动滑块完成验证"; track.classList.remove("verified"); }
    thumb.addEventListener("pointerdown", (e) => { isDragging = true; startX = e.clientX || e.touches?.[0]?.clientX; thumb.setPointerCapture(e.pointerId || 1); });
    window.addEventListener("pointermove", (e) => { if (!isDragging) return; const clientX = e.clientX || e.touches?.[0]?.clientX; const diff = clientX - startX; currentX = Math.min(Math.max(0, diff), maxOffset); thumb.style.transform = `translateX(${currentX}px)`; if (currentX >= maxOffset) { isDragging = false; setVerified(); } });
    window.addEventListener("pointerup", (e) => { if (!isDragging) return; isDragging = false; if (currentX < maxOffset) resetSlider(); else setVerified(); thumb.releasePointerCapture(e.pointerId || 1); });
    resetSlider();
  });
}

function initMusicAutofill() {
  document.querySelectorAll('input[type="file"][data-autofill-target]').forEach((input) => {
    const targetId = input.dataset.autofillTarget;
    const target = document.getElementById(targetId);
    if (!target) return;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, "") || file.name;
      if (target && !target.value.trim()) target.value = name;
    });
  });
}

function escapeHtml(text) {
  if (!text) return text;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds === Infinity) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

window.adjustVolume = function(val) {
  const audio = document.querySelector('#room-audio');
  const icon = document.querySelector('#vol-icon');
  if (audio) {
    audio.volume = val;
    if (val == 0) icon.className = 'ri-volume-mute-line';
    else if (val < 0.5) icon.className = 'ri-volume-down-line';
    else icon.className = 'ri-volume-up-line';
  }
};