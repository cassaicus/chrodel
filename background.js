// デフォルト設定
const DEFAULT_SETTINGS = {
  extensionEnabled: true,
  cleanOnStartup: true,
  cleanOnExit: false,
  cleanPeriodically: false,
  interval: "24", // 時間単位
  targetHistory: true,
  targetFormData: true,
  targetDownloads: true,
  targetCache: true,
  lastCleaned: null
};

// 拡張機能インストール時に初期設定を保存
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (result) => {
    const newSettings = {};
    for (const key in DEFAULT_SETTINGS) {
      if (result[key] === undefined) {
        newSettings[key] = DEFAULT_SETTINGS[key];
      }
    }
    if (Object.keys(newSettings).length > 0) {
      chrome.storage.local.set(newSettings, () => {
        console.log("Default settings initialized:", newSettings);
        setupAlarm();
      });
    } else {
      setupAlarm();
    }
  });
});

// アラーム設定のセットアップ
function setupAlarm() {
  chrome.storage.local.get(["cleanPeriodically", "interval"], (settings) => {
    chrome.alarms.clear("auto-clean-alarm", () => {
      if (settings.cleanPeriodically) {
        const intervalInMinutes = parseFloat(settings.interval) * 60;
        // 定期実行アラームを作成
        chrome.alarms.create("auto-clean-alarm", {
          periodInMinutes: intervalInMinutes
        });
        console.log(`Alarm scheduled to run every ${intervalInMinutes} minutes.`);
      } else {
        console.log("Periodic cleaning is disabled. Alarm cleared.");
      }
    });
  });
}

// データを削除するメイン処理
function performCleanup() {
  chrome.storage.local.get(
    ["extensionEnabled", "targetHistory", "targetFormData", "targetDownloads", "targetCache"],
    (settings) => {
      // 拡張機能が無効化されている場合は何もしない
      if (settings.extensionEnabled === false) {
        console.log("Cleanup skipped. Extension is disabled.");
        return;
      }

      const dataToRemove = {};
      
      if (settings.targetHistory) dataToRemove["history"] = true;
      if (settings.targetFormData) dataToRemove["formData"] = true;
      if (settings.targetDownloads) dataToRemove["downloads"] = true;
      if (settings.targetCache) dataToRemove["cache"] = true;

      // 削除対象が一つもない場合は何もしない
      if (Object.keys(dataToRemove).length === 0) {
        console.log("No data selected for removal.");
        return;
      }

      // クッキーやパスワードは削除対象に含まない
      // 過去すべてのデータを削除対象とする (since: 0)
      chrome.browsingData.remove(
        { since: 0 },
        dataToRemove,
        () => {
          const timestamp = new Date().toISOString();
          chrome.storage.local.set({ lastCleaned: timestamp }, () => {
            console.log(`[Auto Cleaner] Cleanup completed at: ${timestamp}`);
          });
        }
      );
    }
  );
}

// ブラウザ起動時のイベントリスナー
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(["cleanOnStartup"], (settings) => {
    if (settings.cleanOnStartup) {
      console.log("Browser started. Running startup cleanup...");
      performCleanup();
    }
  });
});

// アラーム監視
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "auto-clean-alarm") {
    console.log("Alarm triggered. Running periodic cleanup...");
    performCleanup();
  }
});

// ウィンドウが閉じられたときのイベントリスナー（ブラウザ終了時・全閉じ時の代替）
chrome.windows.onRemoved.addListener(() => {
  // すべてのウィンドウが閉じられたか確認する
  chrome.windows.getAll({}, (windows) => {
    if (windows.length === 0) {
      chrome.storage.local.get(["cleanOnExit"], (settings) => {
        if (settings.cleanOnExit) {
          console.log("All windows closed. Running exit cleanup...");
          performCleanup();
        }
      });
    }
  });
});

// メッセージ受信（設定変更などでアラームの再設定や手動クリーンアップが必要な場合）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateAlarm") {
    setupAlarm();
    sendResponse({ success: true });
    return true;
  } else if (message.action === "manualClean") {
    chrome.storage.local.get(
      ["extensionEnabled", "targetHistory", "targetFormData", "targetDownloads", "targetCache"],
      (settings) => {
        if (settings.extensionEnabled === false) {
          sendResponse({ success: false, error: "拡張機能が無効化されています。" });
          return;
        }

        const dataToRemove = {};
        if (settings.targetHistory) dataToRemove["history"] = true;
        if (settings.targetFormData) dataToRemove["formData"] = true;
        if (settings.targetDownloads) dataToRemove["downloads"] = true;
        if (settings.targetCache) dataToRemove["cache"] = true;

        if (Object.keys(dataToRemove).length === 0) {
          sendResponse({ success: false, error: "削除する項目が選択されていません。" });
          return;
        }

        chrome.browsingData.remove({ since: 0 }, dataToRemove, () => {
          const timestamp = new Date().toISOString();
          chrome.storage.local.set({ lastCleaned: timestamp }, () => {
            sendResponse({ success: true, timestamp: timestamp });
          });
        });
      }
    );
    return true; // 非同期レスポンスを示すために true を返す
  }
});
