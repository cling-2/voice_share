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

  async function refreshState() {
    try {
      const response = await fetch(stateUrl);
      if (!response.ok) return;
      const state = await response.json();
      if (label) {
        label.textContent = state.playback_status === "playing" ? "播放中" : "已暂停";
      }
      if (trackLabel) {
        trackLabel.textContent = state.current_track_name
          ? `正在播放：${state.current_track_name}`
          : "暂无播放";
      }
      if (statusBadge) {
        statusBadge.textContent = state.is_active ? "开放" : "已关闭";
        statusBadge.classList.toggle("closed", !state.is_active);
        statusBadge.classList.toggle("active", Boolean(state.is_active));
      }
      if (!audio) return;
      if (!state.is_active) {
        audio.pause();
        return;
      }
      if (state.current_track_file) {
        const newSrc = `/static/uploads/music/${state.current_track_file}`;
        if (!audio.src.includes(state.current_track_file)) {
          audio.src = newSrc;
          await audio.load();
        }
        if (state.playback_status === "playing") {
          await audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
    } catch (error) {
      console.error("room sync error", error);
    }
  }

  refreshState();
  setInterval(refreshState, 2000);
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

