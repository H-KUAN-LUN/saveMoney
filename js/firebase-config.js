// ① 到 Firebase Console → 專案設定 → 一般 → 你的應用程式 → SDK 設定與配置，選「設定」(Config)
//    把那段 firebaseConfig 的內容貼到下面。這些值放在公開的 repo 沒關係，真正保護資料的是 firestore.rules。
// ② allowedEmail 填你要登入的 Gmail，要和 firestore.rules 裡寫的一樣。
//
// apiKey 留空 = 示範模式：不連 Firebase，資料只存在目前這個瀏覽器，方便先看畫面。

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

export const allowedEmail = '';
