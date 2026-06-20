/**
 * @file popup.js
 * @description ポップアップ画面(popup.html)の裏で動作するJavaScriptプログラムです。
 * 画面が読み込まれた際に、chrome.storage.local（Chrome拡張機能のストレージ）から
 * ユーザーの保存した設定を読み出してUIに同期させます。
 * 各トグルの切り替え変更を検知して即座にストレージへ反映し、バックグラウンドの
 * サービスワーカー(background.js)に対してアラームの再設定要求や、
 * 「今すぐ実行」の手動削除メッセージ送信などを行います。
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- DOM要素（HTML内の操作対象タグ）の取得 ---
  
  // 最終クリーンアップ完了日時を表示するテキスト要素
  const lastCleanedTimeEl = document.getElementById("last-cleaned-time");
  // 手動クリーンアップを開始するための実行ボタン
  const cleanNowBtn = document.getElementById("clean-now-btn");
  
  // 削除対象データ設定のチェックボックス（トグルスイッチ）
  const targetHistoryCheck = document.getElementById("target-history");     // 閲覧履歴
  const targetFormDataCheck = document.getElementById("target-formdata");   // フォームデータ
  const targetDownloadsCheck = document.getElementById("target-downloads"); // ダウンロード
  const targetCacheCheck = document.getElementById("target-cache");         // キャッシュ

  // 自動削除のタイミング設定のチェックボックスおよび入力エリア
  const cleanOnStartupCheck = document.getElementById("clean-on-startup");        // 起動時
  const cleanOnExitCheck = document.getElementById("clean-on-exit");              // 終了時
  const cleanPeriodicallyCheck = document.getElementById("clean-periodically");    // 定期実行
  const cleanIntervalSelect = document.getElementById("clean-interval");          // 間隔（セレクト）
  const intervalContainer = document.getElementById("interval-container");        // 間隔行のコンテナ
  const extensionEnabledCheck = document.getElementById("extension-enabled");      // 全体の有効/無効


  // --- ヘルパー関数（汎用的な便利関数）の定義 ---

  /**
   * ISO形式の文字列（日時）を「YYYY/MM/DD HH:MM:SS」の分かりやすい日本語フォーマットに変換する関数
   * @param {string|null} isoString ISO日時文字列 (例: "2026-06-20T14:30:00.000Z")
   * @returns {string} フォーマットされた日付文字列
   */
  function formatDateTime(isoString) {
    if (!isoString) return "未実行"; // まだ一度もクリーンアップが走っていない初期状態の表示
    const date = new Date(isoString);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0'); // 月は0から始まるため +1 し、2桁埋めする
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}`;
  }

  // --- 保存された設定値の読み込みと初期化 ---

  // chrome.storage.localから以前保存したすべての設定を読み込む
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
    // 取得した設定値が存在すればそれを適用し、存在しなければ初期値（デフォルト）をトグルに割り当てる
    extensionEnabledCheck.checked = settings.extensionEnabled !== false; // 未設定ならデフォルトで有効(true)
    targetHistoryCheck.checked = settings.targetHistory !== false;
    targetFormDataCheck.checked = settings.targetFormData !== false;
    targetDownloadsCheck.checked = settings.targetDownloads !== false;
    targetCacheCheck.checked = settings.targetCache !== false;
    
    cleanOnStartupCheck.checked = settings.cleanOnStartup !== false;
    cleanOnExitCheck.checked = settings.cleanOnExit === true;            // デフォルトは無効(false)
    cleanPeriodicallyCheck.checked = settings.cleanPeriodically === true;
    cleanIntervalSelect.value = settings.interval || "24";               // デフォルトは24時間
    
    // 前回のクリーンアップ日時をフォーマットして画面に表示
    lastCleanedTimeEl.textContent = formatDateTime(settings.lastCleaned);

    // 全体の有効/無効(ON/OFF)状態に応じて、画面内の他のカード要素を非活性(グレーアウト)にする
    toggleExtensionState(extensionEnabledCheck.checked);
    // 定期実行のON/OFF状態に応じて、実行間隔入力エリアのグレーアウト状態を切り替える
    toggleIntervalContainer(cleanPeriodicallyCheck.checked);
    // 削除対象が１つも選ばれていない状況を防ぐためのチェックボックスバリデーションを実行
    validateCheckboxes();
  });


  // --- UI表示制御ロジック ---

  /**
   * 拡張機能全体が有効か無効かに応じて、設定カード全体の見た目を切り替える関数
   * @param {boolean} enabled 有効の場合はtrue, 無効の場合はfalse
   */
  function toggleExtensionState(enabled) {
    // メインスイッチカード以外のすべてのカード要素を取得
    const cardsToToggle = document.querySelectorAll(".app-main > .card:not(.main-switch-card)");
    cardsToToggle.forEach(card => {
      if (enabled) {
        card.classList.remove("disabled-state"); // 有効な時は通常表示（操作可能）
      } else {
        card.classList.add("disabled-state");    // 無効な時は半透明グレーアウト（操作不可）
      }
    });
  }

  /**
   * 定期的な削除のON/OFF設定に応じて、実行間隔セレクタ行の表示（グレーアウト）を制御する関数
   * @param {boolean} show 定期実行が有効の場合はtrue, 無効の場合はfalse
   */
  function toggleIntervalContainer(show) {
    if (show) {
      intervalContainer.classList.remove("disabled"); // 有効時は操作可能に
    } else {
      intervalContainer.classList.add("disabled");    // 無効時はグレーアウト
    }
  }

  /**
   * 削除対象のチェックボックス（履歴、フォーム、ダウンロード、キャッシュ）がいずれか一つでも
   * ONになっているかを検証する関数。すべてのトグルがOFFになった場合、「今すぐ実行」を無効化する。
   */
  function validateCheckboxes() {
    const anyChecked = targetHistoryCheck.checked || 
                       targetFormDataCheck.checked || 
                       targetDownloadsCheck.checked || 
                       targetCacheCheck.checked;
    
    // チェックが１つも入っていない場合、実行ボタンを押せなくする
    cleanNowBtn.disabled = !anyChecked;
    
    // 視覚的にもボタンを薄くし、ホバー等の反応を遮断する
    if (!anyChecked) {
      cleanNowBtn.style.opacity = "0.5";
      cleanNowBtn.style.pointerEvents = "none";
    } else {
      cleanNowBtn.style.opacity = "1";
      cleanNowBtn.style.pointerEvents = "auto";
    }
  }

  /**
   * 画面上の設定変更を chrome.storage.local に自動で上書き保存する共通関数
   * @param {string} key 保存する設定のキー名
   * @param {any} value 保存する値
   * @param {function} callback 保存が完了した後に実行したいコールバック処理（省略可能）
   */
  function saveSetting(key, value, callback) {
    chrome.storage.local.set({ [key]: value }, () => {
      console.log(`ストレージへ設定を保存しました: ${key} = ${value}`);
      if (callback) callback();
    });
  }


  // --- イベントリスナー（操作イベントの監視）の登録 ---

  // 削除対象チェックボックスのクリック操作を監視
  [targetHistoryCheck, targetFormDataCheck, targetDownloadsCheck, targetCacheCheck].forEach(checkbox => {
    checkbox.addEventListener("change", (e) => {
      // 変更されたチェックボックスのID名に応じて、保存用キー名にマッピングする
      const key = e.target.id === "target-history" ? "targetHistory" :
                  e.target.id === "target-formdata" ? "targetFormData" :
                  e.target.id === "target-downloads" ? "targetDownloads" : "targetCache";
      // 変更後の値をストレージにセーブし、検証関数(validateCheckboxes)を実行
      saveSetting(key, e.target.checked, validateCheckboxes);
    });
  });

  // 「ブラウザ起動時に実行」チェックボックスの操作を監視
  cleanOnStartupCheck.addEventListener("change", (e) => {
    saveSetting("cleanOnStartup", e.target.checked);
  });

  // 「ブラウザ終了時に実行」チェックボックスの操作を監視
  cleanOnExitCheck.addEventListener("change", (e) => {
    saveSetting("cleanOnExit", e.target.checked);
  });

  // 最上部「自動クリーンアップ」メインスイッチの操作を監視
  extensionEnabledCheck.addEventListener("change", (e) => {
    // 画面状態を連動して切り替える
    toggleExtensionState(e.target.checked);
    // 設定を保存したのち、バックグラウンドスクリプトへアラーム状態の再設定（解除またはスケジュール）を通知
    saveSetting("extensionEnabled", e.target.checked, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 「定期的に自動で実行」チェックボックスの操作を監視
  cleanPeriodicallyCheck.addEventListener("change", (e) => {
    // 実行間隔セレクタ行のグレーアウトを切り替える
    toggleIntervalContainer(e.target.checked);
    // 設定を保存したのち、バックグラウンドスクリプトへアラーム登録/解除の更新メッセージを送信
    saveSetting("cleanPeriodically", e.target.checked, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 定期実行の「実行間隔」セレクトボックスの変更を監視
  cleanIntervalSelect.addEventListener("change", (e) => {
    // 変更された間隔値（時間）を保存したのち、バックグラウンドスクリプトのアラーム設定を変更
    saveSetting("interval", e.target.value, () => {
      chrome.runtime.sendMessage({ action: "updateAlarm" });
    });
  });

  // 「今すぐ実行」手動削除ボタンのクリック処理
  cleanNowBtn.addEventListener("click", () => {
    // 連続クリックによる多重実行を防ぎ、アニメーションを付与するために、ボタンを「実行中」状態にする
    cleanNowBtn.classList.add("loading");
    cleanNowBtn.disabled = true;
    const btnText = cleanNowBtn.querySelector(".btn-text");
    btnText.textContent = "実行中...";

    // バックグラウンドスクリプトへ手動クリーンアップ要求(manualClean)を送信する
    chrome.runtime.sendMessage({ action: "manualClean" }, (response) => {
      // ユーザーに実行の完了が伝わりやすいように、最低0.8秒間の擬似遅延を入れたのち処理を終える
      setTimeout(() => {
        // 回転アニメーション用クラスを外す
        cleanNowBtn.classList.remove("loading");
        
        // バックグラウンド側でのデータ消去が正常に完了した場合
        if (response && response.success) {
          // ボタンを一時的（1.5秒間）に緑色の「完了！」状態へ変更する
          cleanNowBtn.classList.add("success");
          btnText.textContent = "完了！";
          // 画面上の前回のクリーンアップ時刻を最新日時に書き換える
          lastCleanedTimeEl.textContent = formatDateTime(response.timestamp);

          // 1.5秒後にボタンの表示を元の「今すぐ実行」へ戻す
          setTimeout(() => {
            cleanNowBtn.classList.remove("success");
            btnText.textContent = "今すぐ実行";
            validateCheckboxes(); // ボタンの無効状態を再評価して活性化する
          }, 1500);
        } else {
          // 何らかの理由で削除に失敗した場合
          btnText.textContent = "エラー";
          const errorMsg = response ? response.error : "バックグラウンドとの通信エラー";
          console.error("手動クリーンアップに失敗しました:", errorMsg);
          
          // 2秒後に元の状態に戻す
          setTimeout(() => {
            btnText.textContent = "今すぐ実行";
            validateCheckboxes();
          }, 2000);
        }
      }, 800);
    });
  });
});
