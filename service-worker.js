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
    'https://cdn.jsdelivr.net/npm/minisearch@6.3.0/dist/umd/index.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            }
        )
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
    console.log('SW: Notification clicked');
    console.log('SW: Notification data:', event.notification.data);
    event.notification.close();
    
    const data = event.notification.data || {};
    console.log('SW: Extracted data:', data);
    let url = '/';
    
    if (data.date && data.entryId) {
        url = `/?date=${data.date}&entryId=${data.entryId}`;
        console.log('SW: Constructed URL:', url);
    } else {
        console.log('SW: No date/entryId, using default URL');
    }
    
    event.waitUntil(
        clients.openWindow(url).then(client => {
            console.log('SW: Window opened:', client);
            return client;
        })
    );
});
