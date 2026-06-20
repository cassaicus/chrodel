document.addEventListener("DOMContentLoaded", () => {
  // DOM要素の取得
  const lastCleanedTimeEl = document.getElementById("last-cleaned-time");
  const cleanNowBtn = document.getElementById("clean-now-btn");
  
  const targetHistoryCheck = document.getElementById("target-history");
  const targetFormDataCheck = document.getElementById("target-formdata");
  const targetDownloadsCheck = document.getElementById("target-downloads");
  const targetCacheCheck = document.getElementById("target-cache");
  
  const cleanOnStartupCheck = document.getElementById("clean-on-startup");
  const cleanOnExitCheck = document.getElementById("clean-on-exit");
  const cleanPeriodicallyCheck = document.getElementById("clean-periodically");
  const cleanIntervalSelect = document.getElementById("clean-interval");
  const intervalContainer = document.getElementById("interval-container");
  const extensionEnabledCheck = document.getElementById("extension-enabled");

  // 日時のフォーマット変換ヘルパー
  function formatDateTime(isoString) {
    if (!isoString) return "未実行";
    const date = new Date(isoString);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
  }

  // 設定のロード
  chrome.storage.local.get([
    "extensionEnabled",
    "cleanOnStartup",
    "cleanOnExit",
    "cleanPeriodically",
    "interval",
    "targetHistory",
    "targetFormData",
    "targetDownloads",
    "targetCache",
    "lastCleaned"
  ], (settings) => {
    // 値の設定（未定義の場合はデフォルト値）
    extensionEnabledCheck.checked = settings.extensionEnabled !== false;
    targetHistoryCheck.checked = settings.targetHistory !== false;
    targetFormDataCheck.checked = settings.targetFormData !== false;
    targetDownloadsCheck.checked = settings.targetDownloads !== false;
    targetCacheCheck.checked = settings.targetCache !== false;
    
    cleanOnStartupCheck.checked = settings.cleanOnStartup !== false;
    cleanOnExitCheck.checked = settings.cleanOnExit === true;
    cleanPeriodicallyCheck.checked = settings.cleanPeriodically === true;
    cleanIntervalSelect.value = settings.interval || "24";
    
    lastCleanedTimeEl.textContent = formatDateTime(settings.lastCleaned);

    // 有効/無効に応じたUI状態の制御
    toggleExtensionState(extensionEnabledCheck.checked);
    // インターバル入力欄の表示制御
    toggleIntervalContainer(cleanPeriodicallyCheck.checked);
    validateCheckboxes();
  });

  // 全体の有効/無効に応じたUI状態の切り替え
  function toggleExtensionState(enabled) {
    const cardsToToggle = document.querySelectorAll(".app-main > .card:not(.main-switch-card)");
    cardsToToggle.forEach(card => {
      if (enabled) {
        card.classList.remove("disabled-state");
      } else {
        card.classList.add("disabled-state");
      }
    });
  }

  // 定期実行の間隔入力エリアの表示制御
  function toggleIntervalContainer(show) {
    if (show) {
      intervalContainer.classList.remove("disabled");
    } else {
      intervalContainer.classList.add("disabled");
    }
  }

  // いずれかの削除対象がチェックされているか検証する
  function validateCheckboxes() {
    const anyChecked = targetHistoryCheck.checked || 
                       targetFormDataCheck.checked || 
                       targetDownloadsCheck.checked || 
                       targetCacheCheck.checked;
    cleanNowBtn.disabled = !anyChecked;
    
    // 視覚的フィードバック
    if (!anyChecked) {
      cleanNowBtn.style.opacity = "0.5";
      cleanNowBtn.style.pointerEvents = "none";
    } else {
      cleanNowBtn.style.opacity = "1";
      cleanNowBtn.style.pointerEvents = "auto";
    }
  }

  // 設定保存の共通処理
  function saveSetting(key, value, callback) {
    chrome.storage.local.set({ [key]: value }, () => {
      console.log(`Setting saved: ${key} = ${value}`);
      if (callback) callback();
    });
  }

  // 削除対象の変更イベント
  [targetHistoryCheck, targetFormDataCheck, targetDownloadsCheck, targetCacheCheck].forEach(checkbox => {
    checkbox.addEventListener("change", (e) => {
      const key = e.target.id === "target-history" ? "targetHistory" :
                  e.target.id === "target-formdata" ? "targetFormData" :
                  e.target.id === "target-downloads" ? "targetDownloads" : "targetCache";
      saveSetting(key, e.target.checked, validateCheckboxes);
    });
  });

  // 起動時削除の変更イベント
  cleanOnStartupCheck.addEventListener("change", (e) => {
    saveSetting("cleanOnStartup", e.target.checked);
  });

  // 終了時削除の変更イベント
  cleanOnExitCheck.addEventListener("change", (e) => {
    saveSetting("cleanOnExit", e.target.checked);
  });

  // 全体ON/OFFトグルの変更イベント
  extensionEnabledCheck.addEventListener("change", (e) => {
    toggleExtensionState(e.target.checked);
    saveSetting("extensionEnabled", e.target.checked, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 定期実行の変更イベント
  cleanPeriodicallyCheck.addEventListener("change", (e) => {
    toggleIntervalContainer(e.target.checked);
    saveSetting("cleanPeriodically", e.target.checked, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 実行間隔の変更イベント
  cleanIntervalSelect.addEventListener("change", (e) => {
    saveSetting("interval", e.target.value, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 今すぐ実行ボタンの処理
  cleanNowBtn.addEventListener("click", () => {
    // 状態を「実行中」に変更
    cleanNowBtn.classList.add("loading");
    cleanNowBtn.disabled = true;
    const btnText = cleanNowBtn.querySelector(".btn-text");
    btnText.textContent = "実行中...";

    chrome.runtime.sendMessage({ action: "manualClean" }, (response) => {
      // 少しの遅延を設けて完了アニメーションを表現
      setTimeout(() => {
        cleanNowBtn.classList.remove("loading");
        
        if (response && response.success) {
          cleanNowBtn.classList.add("success");
          btnText.textContent = "完了！";
          lastCleanedTimeEl.textContent = formatDateTime(response.timestamp);

          // 1.5秒後にボタン表示を元に戻す
          setTimeout(() => {
            cleanNowBtn.classList.remove("success");
            btnText.textContent = "今すぐ実行";
            validateCheckboxes();
          }, 1500);
        } else {
          btnText.textContent = "エラー";
          const errorMsg = response ? response.error : "通信エラーが発生しました";
          console.error("Cleanup failed:", errorMsg);
          
          setTimeout(() => {
            btnText.textContent = "今すぐ実行";
            validateCheckboxes();
          }, 2000);
        }
      }, 800);
    });
  });
});
