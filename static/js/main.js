document.addEventListener("DOMContentLoaded", () => {
  initSliderVerification();
  initGlobalControls();
  initChatControls();
  initRoomSync();
  initMusicAutofill();
});

// --- 1. 统一按钮控制 (修复版：兼容 data-action) ---
function initGlobalControls() {
  document.body.addEventListener('click', async (e) => {
    // 1. 查找按钮
    const btn = e.target.closest('.control-btn');
    if (!btn) return;

    // 2. 阻止默认行为 (防止表单提交刷新)
    e.preventDefault();
    e.stopPropagation();

    const form = btn.closest('form');
    if (!form) return;

    // 3. 视觉反馈
    if (btn.disabled) return;
    const originalOpacity = btn.style.opacity;
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'wait';

    // 4. 构造数据
    const formData = new FormData();

    // 补全 CSRF
    if (form) {
        const csrfInput = form.querySelector('input[name="csrf_token"]');
        if (csrfInput) formData.append('csrf_token', csrfInput.value);
    } else {
        const anyCsrf = document.querySelector('input[name="csrf_token"]');
        if (anyCsrf) formData.append('csrf_token', anyCsrf.value);
    }

    // [关键修复] 优先读取 data-action，其次 value
    const action = btn.dataset.action || btn.value || btn.getAttribute('value');
    if (action) formData.append('action', action);

    // 补全 Music/Item ID (用于切歌/删除)
    if (form) {
        const musicIn = form.querySelector('input[name="music_id"]');
        if (musicIn) formData.append('music_id', musicIn.value);
        const itemIn = form.querySelector('input[name="item_id"]');
        if (itemIn) formData.append('item_id', itemIn.value);
    }

    // 补全进度
    const audio = document.querySelector('#room-audio');
    let pos = 0;
    if (audio && !isNaN(audio.currentTime)) {
      pos = audio.currentTime;
    }
    formData.append('position', pos);

    // 5. 发送请求
    // 优先用 form.action，没有则用 roomConfig
    let targetUrl = form.action;
    if ((!targetUrl || targetUrl === window.location.href) && window.roomConfig) {
        targetUrl = window.roomConfig.toggleUrl;
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        // 成功！立即触发同步
        if (window.manualRefreshState) await window.manualRefreshState();
      } else {
        console.error("操作失败:", response.status);
      }
    } catch (err) {
      console.error("网络错误:", err);
    } finally {
      // 恢复按钮
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = originalOpacity || '1';
        btn.style.cursor = 'pointer';
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
    const content = input.value.trim();
    if (!content) return;

    const btn = chatForm.querySelector('.send-btn');
    btn.disabled = true;

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
    finally {
        btn.disabled = false;
        input.focus();
    }
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

  // 用于自动切歌的状态
  let currentPlaylist = [];
  let currentTrackName = "";

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

    // 自动切歌逻辑
    audio.addEventListener("ended", () => {
        if (!isOwner) return;
        console.log("播放结束，尝试切歌...");

        const currentIndex = currentPlaylist.findIndex(item => item.title === currentTrackName);
        const csrfToken = document.querySelector('input[name="csrf_token"]')?.value || '';
        const formData = new FormData();
        formData.append('csrf_token', csrfToken);

        if (currentIndex !== -1 && currentIndex < currentPlaylist.length - 1) {
            // 下一首
            const nextMusic = currentPlaylist[currentIndex + 1];
            formData.append('music_id', nextMusic.music_id);
            // 这里不需要 action，只要有 music_id 后端就会切歌
        } else {
            // 没有下一首，停止
            formData.append('action', 'stop');
        }

        // 发送请求
        fetch(toggleUrl, {
            method: 'POST',
            body: formData
        }).then(async (res) => {
            if (res.ok && window.manualRefreshState) await window.manualRefreshState();
        });
    });
  }

  async function refreshState() {
    try {
      const response = await fetch(stateUrl);
      // [新增] 处理房间已删除 (404 Not Found)
      // 当房主删除房间后，room_state 接口会返回 404
      if (response.status === 404) {
        alert("房间已解散，正在返回首页...");
        window.location.href = "/dashboard";
        return;
      }

      // [新增] 处理房间已关闭 (403 Forbidden)
      // 当房主关闭房间后，非房主成员调用 room_state 会返回 403
      if (response.status === 403) {
        alert("房间已打烊，正在返回首页...");
        window.location.href = "/dashboard";
        return;
      }

      if (!response.ok) return;
      const state = await response.json();

      // [新增] 实时更新在线人数
      if (state.member_count !== undefined) {
          const countEl = document.getElementById("member-count-display");
          if (countEl) countEl.textContent = state.member_count;
      }
      // 更新本地状态
      if (state.playlist) currentPlaylist = state.playlist;
      currentTrackName = state.current_track_name;

      // UI 更新
      if (label) label.textContent = state.playback_status === "playing" ? "播放中" : "已暂停";

      if (statusDot) {
        statusDot.classList.remove('playing', 'paused');
        if (state.current_track_name) statusDot.classList.add(state.playback_status);
      }

      if (trackLabel) {
        if (state.current_track_name) {
            const newTitle = state.current_track_name;
            if (trackLabel.textContent.trim() !== newTitle) trackLabel.textContent = newTitle;
            trackLabel.classList.remove('empty-hint');
        } else {
            trackLabel.textContent = "请添加歌曲吧";
            trackLabel.classList.add('empty-hint');
        }
      }

      // --- 按钮自动切换 (关键修复：生成的 HTML 必须带 type="button" 和 data-action) ---
      if (hostBtnWrapper) {
          const currentBtn = hostBtnWrapper.querySelector('.control-btn');

          if (!state.current_track_name) {
              // 没歌时显示灰色播放键
              if (!currentBtn || currentBtn.classList.contains('pause')) {
                   hostBtnWrapper.innerHTML = `
                    <button type="button" class="control-btn play" data-action="play" title="全员播放" disabled style="opacity:0.5; cursor:not-allowed;">
                      <i class="ri-play-mini-fill"></i> 播放全员
                    </button>`;
              }
          } else {
              // 有歌
              if (currentBtn) {
                  const btnAction = currentBtn.dataset.action || currentBtn.value;

                  if (state.playback_status === 'playing' && btnAction === 'play') {
                      // 变成暂停键
                      hostBtnWrapper.innerHTML = `
                        <button type="button" class="control-btn pause" data-action="pause" title="全员暂停">
                          <i class="ri-pause-mini-fill"></i> 暂停全员
                        </button>`;
                  } else if (state.playback_status !== 'playing' && btnAction === 'pause') {
                      // 变成播放键
                      hostBtnWrapper.innerHTML = `
                        <button type="button" class="control-btn play" data-action="play" title="全员播放">
                          <i class="ri-play-mini-fill"></i> 播放全员
                        </button>`;
                  }
              }
          }
      }

      // 歌单 & 聊天同步
      if (playlistContainer && state.playlist) {
          updatePlaylistUI(playlistContainer, state.playlist, state.current_track_name, isOwner, toggleUrl, playlistDeleteUrl);
      }
      if (chatLog && state.messages) updateChatLog(chatLog, state.messages);

      // 音频同步
      if (audio && state.is_active) {
          if (state.current_track_file) {
            const targetSrc = `/static/uploads/music/${state.current_track_file}`;
            const currentSrcPath = decodeURIComponent(audio.src).split('/static/uploads/music/')[1];

            // 切歌
            if (currentSrcPath !== state.current_track_file) {
              audio.src = targetSrc;
              if (state.current_position > 0) audio.currentTime = state.current_position;
              try {
                  await audio.load();
                  if (state.playback_status === "playing") audio.play().catch(()=>{});
              } catch (e) { console.error(e); }
            }

            // 进度修正
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

            // 状态控制
            if (state.playback_status === "playing") {
                if (audio.paused) audio.play().catch(()=>{});
                if (vinylWrapper) vinylWrapper.classList.add('spinning');
            } else {
                if (!audio.paused) audio.pause();
                if (vinylWrapper) vinylWrapper.classList.remove('spinning');
            }
          } else {
              // Stop 状态：停止并重置
              if (!audio.paused) audio.pause();
              audio.currentTime = 0;
              if (vinylWrapper) vinylWrapper.classList.remove('spinning');
              if (audio.src) audio.removeAttribute('src');
          }
      }
    } catch (e) { console.error(e); }
  }

  window.manualRefreshState = refreshState;
  refreshState();
  setInterval(refreshState, 2000);
}

// --- 4. 歌单渲染 (确保按钮带 type="button" 和 data-action) ---
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
                // 播放按钮
                actionsHtml += `
                    <form method="post" action="${toggleUrl}" class="inline-btn-form">
                        <input type="hidden" name="csrf_token" value="${csrfToken}" />
                        <input type="hidden" name="music_id" value="${item.music_id}" />
                        <button type="button" class="icon-btn-sm control-btn" title="播放" data-action="play">
                            <i class="ri-play-mini-fill"></i>
                        </button>
                    </form>
                `;
                // 删除按钮
                actionsHtml += `
                    <form method="post" action="${deleteUrl}" class="inline-btn-form">
                        <input type="hidden" name="csrf_token" value="${csrfToken}" />
                        <input type="hidden" name="item_id" value="${item.id}" />
                        <button type="button" class="icon-btn-sm danger control-btn" title="删除" data-action="delete">
                            <i class="ri-delete-bin-line"></i>
                        </button>
                    </form>
                `;
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

// (辅助函数保持不变)
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