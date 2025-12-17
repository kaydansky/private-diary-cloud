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
