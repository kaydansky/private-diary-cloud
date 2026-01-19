const CACHE_NAME = 'diary-cloud-v1.2.5';
const CDN_CACHE_NAME = 'diary-cloud-cdn-v1';
const IMAGE_CACHE_NAME = 'diary-cloud-images-v1';

// Only critical app files — fail gracefully if unavailable
const CRITICAL_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/config.js',
    '/translations.js',
    '/manifest.json'
];

// 3rd-party assets to cache at runtime (stale-while-revalidate)
const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Cache only critical assets; don't block install if CDN fails
                return cache.addAll(CRITICAL_ASSETS)
                    .catch(err => console.warn('Install: failed to cache some critical assets', err));
            })
            .then(() => self.skipWaiting())
    );
});

// Remove all old caches when this SW activates
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME && name !== CDN_CACHE_NAME && name !== IMAGE_CACHE_NAME)
                    .map(name => {
                        console.log('Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // 1. Skip cross-origin requests (CORS issues)
    if (!url.origin.includes(self.location.origin) && !CDN_URLS.some(cdn => url.href.startsWith(cdn))) {
        return;
    }

    // 2. API calls to Supabase: network-first with fallback to cache
    if (url.origin.includes('supabase') || url.pathname.includes('/rest/v1/')) {
        return event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Cache successful API responses
                    if (response && response.status === 200 && event.request.method === 'GET') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(err => {
                    // Network failed; try cache as fallback
                    return caches.match(event.request)
                        .then(cached => cached || new Response('Offline', { status: 503 }));
                })
        );
    }

    // 3. CDN assets: stale-while-revalidate (serve cached, update in background)
    if (CDN_URLS.some(cdn => url.href.startsWith(cdn))) {
        return event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    const fetched = fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            const clone = response.clone();
                            caches.open(CDN_CACHE_NAME).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    }).catch(() => cached || new Response('Not cached', { status: 503 }));

                    return cached || fetched;
                })
        );
    }

    // 4. Images: stale-while-revalidate (Supabase Storage)
    if (url.href.includes('supabase') && (url.pathname.endsWith('.jpg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webp'))) {
        return event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    const fetched = fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            const clone = response.clone();
                            caches.open(IMAGE_CACHE_NAME).then(cache => cache.put(event.request, clone));
                        }
                        return response;
                    }).catch(() => cached || new Response('Image not cached', { status: 503 }));

                    return cached || fetched;
                })
        );
    }

    // 5. Default: cache-first for static assets (app.js, styles.css, etc.)
    event.respondWith(
        caches.match(event.request)
            .then(cached => cached || fetch(event.request).catch(err => new Response('Offline', { status: 503 })))
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
