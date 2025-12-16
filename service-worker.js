const CACHE_NAME = 'diary-cloud-v2';
const urlsToCache = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Network-first for app files
    if (url.origin === location.origin) {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(event.request))
        );
        return;
    }
    
    // Cache-first for CDN resources
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});


// Push notification handler
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    const options = {
        body: data.body || 'Новое сообщение | СНТ Тишинка',
        icon: data.icon || '/assets/icons/icon.svg',
        badge: data.badge || '/assets/icons/icon.svg',
        vibrate: [200, 100, 200],
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
