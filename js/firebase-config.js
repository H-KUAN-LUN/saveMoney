// Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定和配置，選「設定」(Config)
// 這些值放在公開的 repo 沒關係，它們不是密碼；真正保護資料的是 Firestore 的安全規則。
//
// apiKey 留空 = 示範模式：不連 Firebase，資料只存在目前這個瀏覽器。

export const firebaseConfig = {
  apiKey: 'AIzaSyDtexdNqfhDIl4danhrCd8AioDZZ5sSAf4',
  authDomain: 'savemoney-53d20.firebaseapp.com',
  projectId: 'savemoney-53d20',
  storageBucket: 'savemoney-53d20.firebasestorage.app',
  messagingSenderId: '611823515320',
  appId: '1:611823515320:web:b5a09c2d5687adf256664d',
};

// 選填：只讓這個 Gmail 登入畫面。repo 是公開的，填了等於公開你的 email，所以留空；
// 擋人的工作交給 Firestore 安全規則（規則在 Firebase Console 裡，不公開）。
export const allowedEmail = '';
