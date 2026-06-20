/**
 * @file background.js
 * @description 拡張機能のバックグラウンドで動作するサービスワーカー（Service Worker）です。
 * ブラウザ起動時のイベント監視、ブラウザ終了時（ウィンドウ全閉じ時）のイベント監視、
 * chrome.alarms APIを使用した定期的な自動削除処理、およびポップアップ画面からの
 * メッセージ受信（手動削除の実行要求やアラーム設定の更新要求）などを一手に引き受けます。
 */

// 拡張機能の初期化時に適用されるデフォルトの設定値オブジェクト
const DEFAULT_SETTINGS = {
  extensionEnabled: true,       // 拡張機能自体の有効化状態（trueで機能全体がオン）
  cleanOnStartup: true,        // Chrome起動時に自動削除を実行するかどうか
  cleanOnExit: false,          // Chrome終了時（全ウィンドウが閉じられた時）に自動削除を実行するかどうか
  cleanPeriodically: false,     // バックグラウンドで定期的に自動削除を実行するかどうか
  interval: "24",              // 定期的な削除を行う間隔時間（初期値：24時間ごと）
  targetHistory: true,         // 削除対象：閲覧履歴を削除するかどうか
  targetFormData: true,        // 削除対象：入力フォームデータを削除するかどうか
  targetDownloads: true,       // 削除対象：ダウンロード履歴を削除するかどうか
  targetCache: true,           // 削除対象：キャッシュデータを削除するかどうか
  lastCleaned: null            // 最後にクリーンアップ処理が完了した日時（ISO文字列）
};

// 拡張機能が最初にインストールされたとき、またはアップデートされたときに実行されるイベントリスナー
chrome.runtime.onInstalled.addListener(() => {
  // すでに保存されている設定があるかを確認するため、chrome.storageから値を取得する
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (result) => {
    const newSettings = {};
    // DEFAULT_SETTINGSの各項目について、まだ保存されていなければデフォルト値を書き込む準備をする
    for (const key in DEFAULT_SETTINGS) {
      if (result[key] === undefined) {
        newSettings[key] = DEFAULT_SETTINGS[key];
      }
    }
    // 未設定の項目があれば、それらをまとめて chrome.storage.local に保存する
    if (Object.keys(newSettings).length > 0) {
      chrome.storage.local.set(newSettings, () => {
        console.log("初期設定が保存されました:", newSettings);
        // 設定保存後に、アラームスケジュールをセットアップする
        setupAlarm();
      });
    } else {
      // すでに設定がすべて存在する場合は、そのままアラームのみセットアップする
      setupAlarm();
    }
  });
});

// 定期クリーンアップ用のアラームスケジュールを設定・更新する関数
function setupAlarm() {
  // ストレージから、定期実行が有効かどうか、およびその実行間隔を取得する
  chrome.storage.local.get(["cleanPeriodically", "interval"], (settings) => {
    // 既存のアラーム（古い設定）を一旦クリア（削除）する
    chrome.alarms.clear("auto-clean-alarm", () => {
      // 定期実行が有効な場合のみ、新規にアラームをセットアップする
      if (settings.cleanPeriodically) {
        // 設定された時間（hour）を分（minute）に変換する
        const intervalInMinutes = parseFloat(settings.interval) * 60;
        // 定期的に発火するアラームを登録する
        chrome.alarms.create("auto-clean-alarm", {
          periodInMinutes: intervalInMinutes
        });
        console.log(`定期削除のアラームを設定しました: ${intervalInMinutes}分ごと`);
      } else {
        console.log("定期クリーンアップは無効に設定されているため、アラームを解除しました。");
      }
    });
  });
}

// ユーザーが設定した削除対象データを実際にクリーンアップするコア関数
function performCleanup() {
  // ストレージから必要な設定（機能の有効状態、削除対象の個別設定）を取得する
  chrome.storage.local.get(
    ["extensionEnabled", "targetHistory", "targetFormData", "targetDownloads", "targetCache"],
    (settings) => {
      // 拡張機能自体のトグルがOFF（無効化）されている場合は、何もせずに処理を抜ける
      if (settings.extensionEnabled === false) {
        console.log("自動クリーンアップは現在無効化されているため、処理をスキップしました。");
        return;
      }

      // chrome.browsingData APIに渡すための削除対象指定オブジェクトを作成する
      const dataToRemove = {};
      
      // 各項目のトグルがONの場合のみ、APIの削除フラグをtrueにセットする
      if (settings.targetHistory) dataToRemove["history"] = true;    // 閲覧履歴
      if (settings.targetFormData) dataToRemove["formData"] = true;   // フォーム入力データ
      if (settings.targetDownloads) dataToRemove["downloads"] = true; // ダウンロード履歴
      if (settings.targetCache) dataToRemove["cache"] = true;         // キャッシュデータ

      // 削除対象となる項目が1つも選択されていない場合は、何もせずに処理を抜ける
      if (Object.keys(dataToRemove).length === 0) {
        console.log("クリーンアップ対象のデータ項目が選択されていません。");
        return;
      }

      // chrome.browsingData.remove APIを呼び出して実際にデータを消去する
      // { since: 0 } は「全期間（過去すべて）」のデータを削除対象にすることを指定
      // パスワードやクッキーなどの重要情報は、dataToRemoveオブジェクトに含めないことで絶対に削除されません
      chrome.browsingData.remove(
        { since: 0 },
        dataToRemove,
        () => {
          // 削除が正常に完了した日時を現在時刻で取得し、ISO文字列にする
          const timestamp = new Date().toISOString();
          // 最終実行日時をストレージに保存し、ポップアップに表示できるようにする
          chrome.storage.local.set({ lastCleaned: timestamp }, () => {
            console.log(`[自動クリーナー] クリーンアップが正常に完了しました: ${timestamp}`);
          });
        }
      );
    }
  );
}

// Google Chromeが新しく起動したときのイベントリスナー
chrome.runtime.onStartup.addListener(() => {
  // ストレージから「起動時に自動削除する」という設定が有効か確認する
  chrome.storage.local.get(["cleanOnStartup"], (settings) => {
    if (settings.cleanOnStartup) {
      console.log("Chromeが起動されました。起動時自動削除を実行します...");
      performCleanup();
    }
  });
});

// 設定されたアラーム（定期削除タイミング）が発火したときのイベントリスナー
chrome.alarms.onAlarm.addListener((alarm) => {
  // 発火したアラームの名前が本機能のものであるかを確認する
  if (alarm.name === "auto-clean-alarm") {
    console.log("定期削除アラームが発火しました。自動削除を実行します...");
    performCleanup();
  }
});

// Chromeのすべてのウィンドウが閉じられたときのイベントリスナー（ブラウザ終了時の代替）
chrome.windows.onRemoved.addListener(() => {
  // 現在開いている他のウィンドウが本当に無いかを確認する
  chrome.windows.getAll({}, (windows) => {
    // 開いているウィンドウ配列の数が 0 であれば、最後のウィンドウが閉じられたことを示す
    if (windows.length === 0) {
      // ストレージから「終了時に自動削除する」という設定が有効か確認する
      chrome.storage.local.get(["cleanOnExit"], (settings) => {
        if (settings.cleanOnExit) {
          console.log("すべてのウィンドウが閉じられました。終了時自動削除を実行します...");
          performCleanup();
        }
      });
    }
  });
});

// ポップアップスクリプト(popup.js)等からメッセージを受信したときのイベントリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // アラームの再設定（定期実行のON/OFFや実行間隔が変更されたとき）の要求を受けた場合
  if (message.action === "updateAlarm") {
    setupAlarm();
    sendResponse({ success: true }); // ポップアップへ成功レスポンスを返す
    return true; // 処理の成功を知らせるために必須
  } 
  // 手動で「今すぐクリーンアップ」が実行された場合の要求を受けた場合
  else if (message.action === "manualClean") {
    // 削除対象項目を設定から取得して削除を実行する
    chrome.storage.local.get(
      ["extensionEnabled", "targetHistory", "targetFormData", "targetDownloads", "targetCache"],
      (settings) => {
        // 拡張機能自体がOFFの場合は、エラーレスポンスを返す
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

        // 全期間の指定で削除を実行
        chrome.browsingData.remove({ since: 0 }, dataToRemove, () => {
          const timestamp = new Date().toISOString();
          // 実行日時をストレージに保存し、ポップアップに最終実行時間として表示可能にする
          chrome.storage.local.set({ lastCleaned: timestamp }, () => {
            // クリーンアップ成功と実行日時をポップアップにレスポンスとして返す
            sendResponse({ success: true, timestamp: timestamp });
          });
        });
      }
    );
    // 非同期でsendResponseを呼び出すため、trueを返すことで接続を維持させる
    return true; 
  }
});
