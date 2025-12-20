const CACHE_NAME = 'diary-cloud-v1';

const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js',
    '/translations.js',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
        );
});

// Remove all old caches when this SW activates
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Push notification handler
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const options = {
        body: data.body || 'Новое сообщение | СНТ Тишинка',
        icon: data.icon || 'assets/icons/icon.svg',
        badge: data.badge || 'assets/icons/icon.svg',
        vibrate: [200, 100, 200],
        tag: 'diary-entry-update',
        renotify: true,
        data: data.data || {}
    };
    event.waitUntil(
        self.registration.showNotification(data.title || 'СНТ Тишинка', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    const data = event.notification.data || {};
    let url = '/';
    
    if (data.date && data.entryId) {
        url = `/?date=${data.date}&entryId=${data.entryId}`;
    }
    
    event.waitUntil(
        clients.openWindow(url)
    );
});
