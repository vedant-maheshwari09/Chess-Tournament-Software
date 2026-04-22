importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCT7OzTUXcB_oNfDQ1KO35tDtjeFDFa_ao",
  authDomain: "chess-tournament-software.firebaseapp.com",
  projectId: "chess-tournament-software",
  storageBucket: "chess-tournament-software.firebasestorage.app",
  messagingSenderId: "799885938023",
  appId: "1:799885938023:web:71533630ffefbeece933c2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icons/icon-192x192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
