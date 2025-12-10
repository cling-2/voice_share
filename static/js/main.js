document.addEventListener("DOMContentLoaded", () => {
  initSliderVerification();
  initGlobalControls();
  initChatControls();
  initRoomSync();
  initMusicAutofill();
});

// --- 1. 统一按钮控制 (终极防失效版) ---
function initGlobalControls() {
  document.body.addEventListener('click', async (e) => {
    // 1. 查找按钮
    const btn = e.target.closest('.control-btn');
    if (!btn) return;

    // 2. 阻止默认行为 (哪怕加了 type="button" 也要阻止)
    e.preventDefault();
    e.stopPropagation();

    const form = btn.closest('form');
    if (!form) return;

    console.log("点击了控制按钮:", btn); // 【调试】

    // 3. 视觉反馈
    const originalOpacity = btn.style.opacity;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'wait';
    // 暂时禁用防止连点，请求结束后恢复
    btn.disabled = true;

    // 4. 构造数据
    const formData = new FormData(form);

    // 补全 CSRF (双重保险)
    if (!formData.has('csrf_token')) {
        const csrf = document.querySelector('input[name="csrf_token"]');
        if (csrf) formData.append('csrf_token', csrf.value);
    }

    // [关键] 优先读取 data-action，其次读取 value
    const action = btn.dataset.action || btn.value || btn.getAttribute('value');
    if (action) {
        formData.append('action', action);
        console.log("发送指令:", action); // 【调试】
    }

    // 补全 Position
    const audio = document.querySelector('#room-audio');
    let pos = 0;
    if (audio && !isNaN(audio.currentTime)) {
      pos = audio.currentTime;
    }
    formData.append('position', pos);

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        console.log("指令执行成功");
        // 立即触发同步
        if (window.manualRefreshState) await window.manualRefreshState();
      } else {
        console.error("操作失败，状态码:", response.status);
        alert("操作失败，请刷新重试");
      }
    } catch (err) {
      console.error("网络错误:", err);
    } finally {
      // 恢复按钮状态
      if (btn) {
        btn.style.opacity = originalOpacity || '1';
        btn.style.cursor = 'pointer';
        btn.disabled = false;
      }
    }
  });
}

// --- 2. 聊天发送逻辑 ---
function initChatControls() {
  const chatForm = document.querySelector('.chat-form');
  if (!chatForm) return;

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = chatForm.querySelector('input[name="content"]');
    if (!input.value.trim()) return;

    const formData = new FormData(chatForm);
    try {
      const response = await fetch(chatForm.action, {
        method: 'POST',
        body: formData
      });
      if (response.ok) {
        input.value = '';
        if (window.manualRefreshState) await window.manualRefreshState();
        const chatLog = document.querySelector("#chat-log");
        if(chatLog) chatLog.scrollTop = chatLog.scrollHeight;
      }
    } catch (e) { console.error(e); }
  });
}

// --- 3. 房间同步核心 ---
function initRoomSync() {
  if (!window.roomConfig) return;
  const { stateUrl, audioSelector, isOwner, toggleUrl, playlistDeleteUrl } = window.roomConfig;
  const audio = document.querySelector(audioSelector);

  const label = document.querySelector("#state-label");
  const trackLabel = document.querySelector("#current-track-label");
  const statusDot = document.querySelector(".status-dot");
  const hostBtnWrapper = document.querySelector("#host-btn-wrapper");
  const playlistContainer = document.querySelector(".playlist-scroll-area");
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
      if (timeDuration && duration) timeDuration.textContent = formatTime(duration);
      if (progressFill && duration) progressFill.style.width = `${(current / duration) * 100}%`;
    });
    audio.addEventListener("loadedmetadata", () => {
      if (timeDuration && audio.duration) timeDuration.textContent = formatTime(audio.duration);
    });
  }

  async function refreshState() {
    try {
      const response = await fetch(stateUrl);
      if (!response.ok) return;
      const state = await response.json();

      // UI 更新
      if (label) label.textContent = state.playback_status === "playing" ? "播放中" : "已暂停";
      if (statusDot) {
        statusDot.classList.remove('playing', 'paused');
        statusDot.classList.add(state.playback_status);
      }
      if (trackLabel) {
        const newTitle = state.current_track_name || "等待播放...";
        if (trackLabel.textContent.trim() !== newTitle) trackLabel.textContent = newTitle;
      }

      // --- 按钮自动切换 (关键：生成的 HTML 必须带 type="button" 和 data-action) ---
      if (hostBtnWrapper) {
          const currentBtn = hostBtnWrapper.querySelector('.control-btn');
          if (currentBtn) {
              const btnAction = currentBtn.dataset.action || currentBtn.value;

              if (state.playback_status === 'playing' && btnAction === 'play') {
                  // 显示暂停键
                  hostBtnWrapper.innerHTML = `
                    <button type="button" class="control-btn pause" data-action="pause" title="全员暂停">
                      <i class="ri-pause-mini-fill"></i> 暂停全员
                    </button>`;
              } else if (state.playback_status !== 'playing' && btnAction === 'pause') {
                  // 显示播放键
                  hostBtnWrapper.innerHTML = `
                    <button type="button" class="control-btn play" data-action="play" title="全员播放">
                      <i class="ri-play-mini-fill"></i> 播放全员
                    </button>`;
              }
          }
      }

      if (playlistContainer && state.playlist) {
          updatePlaylistUI(playlistContainer, state.playlist, state.current_track_name, isOwner, toggleUrl, playlistDeleteUrl);
      }
      if (chatLog && state.messages) updateChatLog(chatLog, state.messages);

      // 音频同步
      if (audio && state.is_active) {
          if (state.current_track_file) {
            const targetSrc = `/static/uploads/music/${state.current_track_file}`;
            const currentSrcPath = decodeURIComponent(audio.src).split('/static/uploads/music/')[1];

            if (currentSrcPath !== state.current_track_file) {
              audio.src = targetSrc;
              if (state.current_position > 0) audio.currentTime = state.current_position;
              try {
                  await audio.load();
                  if (state.playback_status === "playing") audio.play().catch(()=>{});
              } catch (e) { console.error(e); }
            }

            if (state.current_position !== undefined) {
                 const diff = Math.abs(audio.currentTime - state.current_position);
                 if (state.playback_status === "paused") {
                     if (diff > 0.5) audio.currentTime = state.current_position;
                 } else if (state.playback_status === "playing") {
                     if (isOwner && !audio.paused) {
                         if (diff > 5) audio.currentTime = state.current_position;
                     } else {
                         if (diff > 2) audio.currentTime = state.current_position;
                     }
                 }
            }

            if (state.playback_status === "playing") {
                if (audio.paused) audio.play().catch(()=>{});
                if (vinylWrapper) vinylWrapper.classList.add('spinning');
            } else {
                if (!audio.paused) audio.pause();
                if (vinylWrapper) vinylWrapper.classList.remove('spinning');
            }
          }
      }
    } catch (e) { console.error(e); }
  }

  window.manualRefreshState = refreshState;
  refreshState();
  setInterval(refreshState, 2000);
}

// --- 4. 歌单渲染 ---
function updatePlaylistUI(container, playlist, currentTrackName, isOwner, toggleUrl, deleteUrl) {
    let html = '';
    const csrfToken = document.querySelector('input[name="csrf_token"]')?.value || '';

    if (playlist.length === 0) {
        html = '<div class="empty-list-placeholder">队列空空如也</div>';
    } else {
        playlist.forEach(item => {
            const isPlaying = (item.title === currentTrackName);
            let actionsHtml = '';

            if (isOwner) {
                // 播放和删除按钮也加上 type="button"
                actionsHtml += `
                    <form method="post" action="${toggleUrl}" class="inline-btn-form">
                        <input type="hidden" name="csrf_token" value="${csrfToken}" />
                        <input type="hidden" name="music_id" value="${item.music_id}" />
                        <button type="button" class="icon-btn-sm control-btn" title="播放" data-action="play">
                            <i class="ri-play-mini-fill"></i>
                        </button>
                    </form>
                    <form method="post" action="${deleteUrl}" class="inline-btn-form">
                        <input type="hidden" name="csrf_token" value="${csrfToken}" />
                        <input type="hidden" name="item_id" value="${item.id}" />
                        <button type="button" class="icon-btn-sm danger control-btn" title="删除" data-action="delete">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </form>`;
            }
            html += `
                <div class="playlist-item ${isPlaying ? 'playing' : ''}">
                    <div class="item-info">
                        <span class="item-title">${escapeHtml(item.title)}</span>
                        ${isPlaying ? '<span class="playing-badge"><i class="ri-volume-up-line"></i></span>' : ''}
                    </div>
                    <div class="item-actions" style="display:flex; gap:0.5rem;">${actionsHtml}</div>
                </div>`;
        });
    }
    if (container.innerHTML.trim() !== html.trim()) container.innerHTML = html;
}

// --- 辅助函数 (保持不变) ---
function updateChatLog(container, messages) {
    const existingItems = container.querySelectorAll('.chat-bubble-row');
    const existingIds = new Set();
    existingItems.forEach(el => existingIds.add(parseInt(el.dataset.id)));
    let hasNew = false;
    const noMsg = container.querySelector('.no-msg');

    if (messages.length > 0 && noMsg) noMsg.remove();
    if (messages.length === 0 && !noMsg) container.innerHTML = '<div class="no-msg"><i class="ri-chat-1-line"></i><p>暂无消息，打个招呼吧</p></div>';

    messages.forEach(msg => {
        if (!existingIds.has(msg.id)) {
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

function escapeHtml(t){if(!t)return t;return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
function formatTime(s){if(!s||isNaN(s)||s===Infinity)return"00:00";const m=Math.floor(s/60);const sc=Math.floor(s%60);return`${m.toString().padStart(2,'0')}:${sc.toString().padStart(2,'0')}`;}
function initMusicAutofill(){document.querySelectorAll('input[type="file"][data-autofill-target]').forEach((i)=>{const t=document.getElementById(i.dataset.autofillTarget);if(!t)return;i.addEventListener("change",()=>{const f=i.files&&i.files[0];if(!f)return;const n=f.name.replace(/\.[^.]+$/,"")||f.name;if(t&&!t.value.trim())t.value=n;});});}
function initSliderVerification(){document.querySelectorAll(".slider-verify").forEach((w)=>{const t=w.querySelector(".slider-thumb"),k=w.querySelector(".slider-track"),p=w.querySelector(".slider-tip"),h=document.getElementById(w.dataset.target);if(!t||!k||!h)return;let d=false,s=0,c=0,m=k.offsetWidth-t.offsetWidth-8;function v(){h.value="verified";p.textContent="验证完成";k.classList.add("verified");}function r(){h.value="";t.style.transform="translateX(0px)";p.textContent="拖动滑块完成验证";k.classList.remove("verified");}t.addEventListener("pointerdown",(e)=>{d=true;s=e.clientX||e.touches?.[0]?.clientX;t.setPointerCapture(e.pointerId||1);});window.addEventListener("pointermove",(e)=>{if(!d)return;const x=e.clientX||e.touches?.[0]?.clientX;const f=x-s;c=Math.min(Math.max(0,f),m);t.style.transform=`translateX(${c}px)`;if(c>=m){d=false;v();}});window.addEventListener("pointerup",()=>{if(!d)return;d=false;if(c<m)r();else v();t.releasePointerCapture(event.pointerId||1);});r();});}
window.adjustVolume=function(v){const a=document.querySelector('#room-audio'),i=document.querySelector('#vol-icon');if(a){a.volume=v;if(v==0)i.className='ri-volume-mute-line';else if(v<0.5)i.className='ri-volume-down-line';else i.className='ri-volume-up-line';}};