document.addEventListener("DOMContentLoaded", () => {
  initSliderVerification();
  initRoomSync();
  initMusicAutofill();
});

function initSliderVerification() {
  document.querySelectorAll(".slider-verify").forEach((wrapper) => {
    const thumb = wrapper.querySelector(".slider-thumb");
    const track = wrapper.querySelector(".slider-track");
    const tip = wrapper.querySelector(".slider-tip");
    const hiddenInputId = wrapper.dataset.target;
    const hiddenInput = document.getElementById(hiddenInputId);
    let isDragging = false;
    let startX = 0;
    let currentX = 0;
    const maxOffset = track.offsetWidth - thumb.offsetWidth - 8;

    function setVerified() {
      hiddenInput.value = "verified";
      tip.textContent = "验证完成";
      track.classList.add("verified");
    }

    function resetSlider() {
      hiddenInput.value = "";
      thumb.style.transform = "translateX(0px)";
      tip.textContent = "拖动滑块完成验证";
      track.classList.remove("verified");
    }

    const onPointerDown = (event) => {
      isDragging = true;
      startX = event.clientX || event.touches?.[0]?.clientX;
      thumb.setPointerCapture(event.pointerId || 1);
    };

    const onPointerMove = (event) => {
      if (!isDragging) return;
      const clientX = event.clientX || event.touches?.[0]?.clientX;
      const diff = clientX - startX;
      currentX = Math.min(Math.max(0, diff), maxOffset);
      thumb.style.transform = `translateX(${currentX}px)`;
      if (currentX >= maxOffset) {
        isDragging = false;
        setVerified();
      }
    };

    const onPointerUp = (event) => {
      if (!isDragging) return;
      isDragging = false;
      if (currentX < maxOffset) {
        resetSlider();
      } else {
        setVerified();
      }
      thumb.releasePointerCapture(event.pointerId || 1);
    };

    thumb.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    resetSlider();
  });
}

function initRoomSync() {
  if (!window.roomConfig) return;
  const { stateUrl, audioSelector } = window.roomConfig;
  const audio = document.querySelector(audioSelector);
  const label = document.querySelector("#state-label");
  const trackLabel = document.querySelector("#current-track-label");
  const statusBadge = document.querySelector("#room-status");
  const chatLog = document.querySelector("#chat-log");

  async function refreshState() {
    try {
      const response = await fetch(stateUrl);
      if (!response.ok) return;
      const state = await response.json();

      // 更新播放状态
      if (label) {
        label.textContent = state.playback_status === "playing" ? "播放中" : "已暂停";
      }
      if (trackLabel) {
        trackLabel.textContent = state.current_track_name
          ? state.current_track_name
          : "暂无播放";
      }
      if (statusBadge) {
        statusBadge.textContent = state.is_active ? "开放" : "已关闭";
        statusBadge.classList.toggle("closed", !state.is_active);
        statusBadge.classList.toggle("active", Boolean(state.is_active));
      }

      // 播放器同步逻辑
      if (audio && state.is_active) {
          if (state.current_track_file) {
            const newSrc = `/static/uploads/music/${state.current_track_file}`;
            // 只有当歌曲真正改变时才重新加载，防止拖动进度条被重置
            if (!audio.src.includes(encodeURI(state.current_track_file))) {
              audio.src = newSrc;
              await audio.load();
              // 如果是刚切歌，且状态是播放，则尝试播放
              if (state.playback_status === "playing") {
                  audio.play().catch(() => {});
              }
            }

            // 简单的状态同步：如果服务器在播放，本地暂停，则播放；反之亦然
            // 注意：这可能会干扰用户手动暂停，但在共听场景下，强同步通常是预期的
            if (state.playback_status === "playing" && audio.paused) {
                 audio.play().catch(() => {});
            } else if (state.playback_status === "paused" && !audio.paused) {
                 audio.pause();
            }
          }
      }

      // 聊天同步逻辑
      if (chatLog && state.messages) {
          updateChatLog(chatLog, state.messages);
      }

    } catch (error) {
      console.error("room sync error", error);
    }
  }

  refreshState();
  setInterval(refreshState, 2000);
}

function updateChatLog(container, messages) {
    // 获取当前页面上已有的消息 ID
    const existingItems = container.querySelectorAll('.chat-item');
    const existingIds = new Set();
    existingItems.forEach(el => {
        if (el.dataset.id) existingIds.add(parseInt(el.dataset.id));
    });

    let hasNew = false;
    // 移除“暂无评论”提示
    const noMsg = container.querySelector('.no-msg');

    messages.forEach(msg => {
        if (!existingIds.has(msg.id)) {
            if (noMsg) noMsg.remove();

            const html = `
                <div class="chat-item" data-id="${msg.id}">
                    <img src="${msg.author_avatar}" alt="avatar" class="chat-avatar" />
                    <div class="chat-item-content">
                        <strong>${escapeHtml(msg.author_name)}</strong>
                        <span>${msg.created_at}</span>
                        <p>${escapeHtml(msg.content)}</p>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
            hasNew = true;
        }
    });

    // 如果有新消息，自动滚动到底部
    if (hasNew) {
         container.scrollTop = container.scrollHeight;
    }
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
      target.value = target.value?.trim() ? target.value : name;
    });
  });
}

function escapeHtml(text) {
  if (!text) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}