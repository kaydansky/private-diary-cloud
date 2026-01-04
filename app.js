// Modal manager to handle show/hide for all modals consistently
class ModalManager {
    constructor() {
        this.modals = new Map();
    }

    // Register a modal with optional setup and cleanup callbacks
    register(name, elementId, setupFn = null, cleanupFn = null) {
        this.modals.set(name, { elementId, setupFn, cleanupFn });
    }

    // Show a modal, optionally executing setup callback
    show(name) {
        const modal = this.modals.get(name);
        if (!modal) {
            console.warn(`Modal "${name}" not registered`);
            return;
        }
        const element = document.getElementById(modal.elementId);
        if (element) {
            element.classList.add('show');
            if (modal.setupFn) modal.setupFn();
        }
    }

    // Hide a modal, optionally executing cleanup callback
    hide(name) {
        const modal = this.modals.get(name);
        if (!modal) {
            console.warn(`Modal "${name}" not registered`);
            return;
        }
        const element = document.getElementById(modal.elementId);
        if (element) {
            element.classList.remove('show');
            if (modal.cleanupFn) modal.cleanupFn();
        }
    }

    // Toggle modal visibility
    toggle(name) {
        const modal = this.modals.get(name);
        if (!modal) return;
        const element = document.getElementById(modal.elementId);
        if (element) {
            element.classList.toggle('show');
            if (element.classList.contains('show') && modal.setupFn) {
                modal.setupFn();
            } else if (!element.classList.contains('show') && modal.cleanupFn) {
                modal.cleanupFn();
            }
        }
    }

    // Check if modal is visible
    isVisible(name) {
        const modal = this.modals.get(name);
        if (!modal) return false;
        const element = document.getElementById(modal.elementId);
        return element ? element.classList.contains('show') : false;
    }
}

class LikeDislikeManager {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
    }

    async vote(entryId, isLike) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) {
            throw new Error('Authorization required');
        }

        const { error } = await this.supabase
            .from('likes_dislikes')
            .upsert({
                entry_id: entryId,
                user_id: session.user.id,
                is_like: isLike
            }, {
                onConflict: 'entry_id, user_id'
            });

        if (error) throw error;
    }

    async removeVote(entryId) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session) return;

        const { error } = await this.supabase
            .from('likes_dislikes')
            .delete()
            .match({ entry_id: entryId, user_id: session.user.id });

        if (error) console.error('Error removing vote:', error);
    }

    async getCounts(entryIds) {
        if (!entryIds || !entryIds.length) return [];

        const { data, error } = await this.supabase
            .rpc('get_like_dislike_counts', { entry_ids: entryIds });

        if (error) {
            console.error('Error fetching counters:', error);
            return [];
        }

        return data || [];
    }

    async getUserStatus(entryIds) {
        const { data: { session } } = await this.supabase.auth.getSession();
        if (!session || !entryIds || !entryIds.length) return [];

        const { data, error } = await this.supabase
            .rpc('get_user_like_dislike_status', { entry_ids: entryIds });

        if (error) {
            console.error('Error fetching user status:', error);
            return [];
        }

        return data || [];
    }

    async toggleVote(entryId, currentStatus, isLike) {
        if (currentStatus === isLike) {
            await this.removeVote(entryId);
            return null;
        }

        await this.vote(entryId, isLike);
        return isLike;
    }
}

class DiaryApp {
    constructor() {
        this.supabase = null;
        this.currentDate = new Date();
        this.selectedDate = this.formatDateKey(new Date());
        this.modalManager = new ModalManager();
        this.likeDislikeManager = null;
        this.entries = {};
        this.editingEntryId = null;
        this.originalText = '';
        this.autoSaveEntryId = null;
        this._monthCache = new Map();
        this._imgObserver = null;
        this.currentLanguage = this.initLanguage();
        this.user = null;
        this.isAuthMode = true;
        this.searchQuery = '';
        this.isNotificationsEnabled = false;
        this.broadcastChannel = null; // Track the broadcast channel
        this.parentEntry = null; // To hold parent entry data when replying
        this.quoteMaxLength = 100; // Max length for quoted text
        
        this.initServiceWorker();
        this.initElements();
        this.initAuth();
    }

    initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(registration => {
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
                            }
                        });
                    });
                })
                .then(console.log('Service worker registered'))
                .catch(err => console.error('Service worker registration failed:', err));

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // New SW is controlling the page; reload once to use fresh files
                window.location.reload();
            });
        }
    }

    // Initialize language from localStorage or browser
    initLanguage() {
        const saved = localStorage.getItem('language');
        if (saved && translations[saved]) return saved;
        
        const browserLang = navigator.language.split('-')[0];
        return translations[browserLang] ? browserLang : 'en';
    }

    // Get translation
    t(key) {
        return translations[this.currentLanguage][key] || key;
    }

    // Simple debounce helper bound to the instance
    debounce(fn, wait = 300) {
        let timer = null;
        return (...args) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                try { fn.apply(this, args); } catch (e) { console.error(e); }
            }, wait);
        };
    }

    // Change language
    changeLanguage(lang) {
        this.currentLanguage = lang;
        localStorage.setItem('language', lang);
        this.updateUI();
        this.hideLanguageModal();
    }

    // Update all UI text
    updateUI() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            if (el.id !== 'accountBtn' && !el.closest('#accountBtn')) {
                el.textContent = this.t(el.dataset.i18n);
            }
        });
        
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });
        
        this.searchInput.placeholder = this.t('searchPlaceholder');
        this.entryTextarea.placeholder = this.t('writeThoughts');
        
        const weekdaysContainer = document.getElementById('weekdaysContainer');
        if (weekdaysContainer) {
            weekdaysContainer.innerHTML = this.t('weekdays').map(day => 
                `<div class="weekday">${day}</div>`
            ).join('');
        }
        
        this.monthSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = this.t('selectMonth');
        placeholder.disabled = true;
        placeholder.selected = true;
        this.monthSelect.appendChild(placeholder);
        
        for (let month = 0; month < 12; month++) {
            const option = document.createElement('option');
            option.value = month;
            option.textContent = this.t('months')[month];
            this.monthSelect.appendChild(option);
        }
        this.updateDateSelects();
        
        // if (this.selectedDate) {
        //     this.renderEntries(this.selectedDate);
        // }
        this.renderCalendar();
        
        if (this.user) {
            this.updateAuthUI();
        }
    }

    // Initialize authentication
    async initAuth() {
        if (window.supabase?.createClient) {
            this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        
        if (!this.supabase) {
            console.error('Supabase failed to initialize');
            return;
        }

        this.likeDislikeManager = new LikeDislikeManager(this.supabase);

        const { data: { session } } = await this.supabase.auth.getSession();
        this.user = session?.user || null;
        
        this.supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                this.user = session.user;
                this.showUpdatePasswordModal();
            } else if (event === 'SIGNED_IN') {
                this.user = session.user;
                document.getElementById('authContainer').classList.add('hidden');
                document.getElementById('mainContainer').classList.remove('hidden');
                this.updateAuthUI();
                // await this.broadcast();
                
                // Re-render entries when user signs in to update UI
                if (this.selectedDate) {
                    this.renderEntries(this.selectedDate);
                }
            } else if (event === 'SIGNED_OUT') {
                this.user = null;
                // Clean up broadcast channel when user signs out
                if (this.broadcastChannel) {
                    this.supabase.removeChannel(this.broadcastChannel);
                    this.broadcastChannel = null;
                }
                this.updateAuthUI();
            }
        });
        
        this.showMainApp();
        // await this.broadcast();
        await this.init();
    }

    async broadcast() {
        if (!this.user || this.user.is_anonymous === true) return;

        // Skip if channel already exists
        if (this.broadcastChannel) return;

        // Create a new channel with proper configuration for database changes
        this.broadcastChannel = this.supabase.channel('diary:entries', {config: { private: true }})
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'diary_entries'
            }, (payload) => {
                const data = payload.new;
                // console.log('New diary entry received', payload);
                if (this.user.id === data.user_id) return;
                
                // Update UI: prepend or append new entry
                const newEntry = {
                    id: data.id,
                    user_id: data.user_id,
                    username: data.username,
                    text: data.text,
                    type: 'entry',
                    createdAt: data.created_at
                };
                
                // Ensure entries array exists for the date
                if (!this.entries[data.date]) {
                    this.entries[data.date] = [];
                }
                
                this.entries[data.date].push(newEntry);
                this.showEntries(this.selectedDate);
            })
            .on('postgres_changes', {
                event: 'DELETE',
                schema: 'public',
                table: 'diary_entries'
            }, (payload) => {
                const data = payload.old;
                // console.log('Diary entry deleted', payload);
                const deletedId = data.id;
                
                // Remove from entries array for that date
                this.entries[this.selectedDate] = this.entries[this.selectedDate].filter(e => e.id !== deletedId);
                this.showEntries(this.selectedDate);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Subscribed to diary realtime channel');
                } else {
                    console.log('Channel status:', status);
                }
            });
    }

    // Update auth UI
    async updateAuthUI() {
        const signInBtn = document.getElementById('signInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const accountBtn = document.getElementById('accountBtn');
        const notificationsBtn = document.getElementById('notificationsBtn');
        const addEntryBtn = document.getElementById('addEntryBtn');
        const addPollBtn = document.getElementById('addPollBtn');
        const addImageBtn = document.getElementById('addImageBtn');
        const peopleBtn = document.getElementById('peopleBtn');
        const aiBtn = document.getElementById('aiBtn');

        if (this.user && (this.user.email === 'kaydansky@gmail.com' || this.user.email === 'info@kaydansky.ru')) {
            if (aiBtn) aiBtn.style.display = 'block';
        } else {
            if (aiBtn) aiBtn.style.display = 'none';
        }
        
        if (this.user && this.user.is_anonymous === false) {
            if (signInBtn) signInBtn.style.display = 'none';
            if (footerText) footerText.style.display = 'none';
            if (signOutBtn) signOutBtn.style.display = 'block';
            if (accountBtn) accountBtn.style.display = 'block';
            if (peopleBtn) peopleBtn.style.display = 'block';
            if (notificationsBtn) notificationsBtn.style.display = 'block';
            if (addEntryBtn) addEntryBtn.style.display = 'flex';
            if (addPollBtn) addPollBtn.style.display = 'flex';
            if (addImageBtn) addImageBtn.style.display = 'flex';
            
            if (notificationsBtn) await this.updateNotificationButtonState();
            
            let username = this.user.user_metadata?.username;
            if (!username) {
                const { data } = await this.supabase
                    .from('diary_entries')
                    .select('username')
                    .eq('user_id', this.user.id)
                    .limit(1)
                    .single();
                username = data?.username || 'User';
            }
            
            if (accountBtn) {
                const accountSpan = accountBtn.querySelector('span');
                if (accountSpan) accountSpan.textContent = `${this.t('account')} | ${username}`;
            }
        } else {
            if (signInBtn) signInBtn.style.display = 'block';
            if (footerText) footerText.style.display = 'block';
            if (signOutBtn) signOutBtn.style.display = 'none';
            if (accountBtn) accountBtn.style.display = 'none';
            if (peopleBtn) peopleBtn.style.display = 'none';
            if (notificationsBtn) notificationsBtn.style.display = 'none';
            if (addEntryBtn) addEntryBtn.style.display = 'none';
            if (addImageBtn) addImageBtn.style.display = 'none';
            if (addPollBtn) addPollBtn.style.display = 'none';
        }

        this.toggleAddPollBtn();
    }

    // Show authentication form
    showAuthForm() {
        document.getElementById('authContainer').classList.remove('hidden');
        document.querySelector('.auth-card:first-child').classList.remove('hidden');
        document.getElementById('confirmationCard').classList.add('hidden');
        this.initAuthEventListeners();
    }

    // Show confirmation
    showConfirmation() {
        document.querySelector('.auth-card:first-child').classList.add('hidden');
        document.getElementById('confirmationCard').classList.remove('hidden');
        
        document.getElementById('backToLoginBtn').addEventListener('click', () => {
            this.showAuthForm();
            document.getElementById('loginTab').click();
        }, { once: true });
    }

    // Show main app
    showMainApp() {
        document.getElementById('authContainer').classList.add('hidden');
        document.getElementById('mainContainer').classList.remove('hidden');
        this.isAuthMode = false;
        this.updateAuthUI();
    }

    // Initialize auth event listeners
    initAuthEventListeners() {
        const loginTab = document.getElementById('loginTab');
        const signupTab = document.getElementById('signupTab');
        const authForm = document.getElementById('authForm');
        const authSubmit = document.getElementById('authSubmit');
        const usernameInput = document.getElementById('authUsername');
        const passwordRepeat = document.getElementById('authPasswordRepeat');
        const togglePassword = document.getElementById('togglePassword');
        const togglePasswordRepeat = document.getElementById('togglePasswordRepeat');
        const authPassword = document.getElementById('authPassword');

        togglePassword.addEventListener('click', () => {
            const type = authPassword.type === 'password' ? 'text' : 'password';
            authPassword.type = type;
            togglePassword.querySelector('i').className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
        });

        togglePasswordRepeat.addEventListener('click', () => {
            const type = passwordRepeat.type === 'password' ? 'text' : 'password';
            passwordRepeat.type = type;
            togglePasswordRepeat.querySelector('i').className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
        });

        loginTab.addEventListener('click', () => {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            authSubmit.textContent = this.t('signIn');
            usernameInput.removeAttribute('required');
            passwordRepeat.removeAttribute('required');
            usernameInput.classList.add('hidden');
            passwordRepeat.parentElement.classList.add('hidden');
        });

        signupTab.addEventListener('click', () => {
            signupTab.classList.add('active');
            loginTab.classList.remove('active');
            authSubmit.textContent = this.t('signUp');
            usernameInput.classList.remove('hidden');
            usernameInput.setAttribute('required', '');
            passwordRepeat.parentElement.classList.remove('hidden');
            passwordRepeat.setAttribute('required', '');
        });

        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('authEmail').value;
            const password = document.getElementById('authPassword').value;
            const username = usernameInput.value.trim();
            const isLogin = loginTab.classList.contains('active');

            if (!isLogin) {
                const passwordRepeatValue = passwordRepeat.value;
                if (password !== passwordRepeatValue) {
                    this.showAuthError(this.t('passwordsDoNotMatch'));
                    return;
                }
                if (!/^[a-zA-Zа-яА-Я0-9 ]+$/.test(username) || username.length < 3) {
                    this.showAuthError(this.t('usernameInvalid'));
                    return;
                }
                if (username.length > 20) {
                    this.showAuthError(this.t('usernameTooLong'));
                    return;
                }
            }

            try {
                if (isLogin) {
                    await this.signIn(email, password);
                } else {
                    await this.signUp(email, password, username);
                }
                this.hideAuthError();
            } catch (error) {
                this.showAuthError(error.message);
            }
        });
    }

    // Sign in user
    async signIn(email, password) {
        const { error } = await this.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    // Sign up user
    async signUp(email, password, username) {
        const { data: existingUsers } = await this.supabase
            .from('diary_entries')
            .select('username')
            .ilike('username', username)
            .limit(1);
        
        if (existingUsers && existingUsers.length > 0) {
            throw new Error(this.t('usernameTaken'));
        }
        
        const { data, error } = await this.supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username: username
                }
            }
        });
        if (error) throw error;
        this.showConfirmation();
    }

    // Sign in
    showSignIn() {
        document.getElementById('mainContainer').classList.add('hidden');
        this.showAuthForm();
    }

    // Sign out user
    async signOut() {
        try {
            await this.supabase.auth.signOut();
        } catch (error) {
            // Force local logout on session errors
            if (error.code === 'session_not_found') {
                localStorage.removeItem('supabase.auth.token');
                sessionStorage.clear();
            } else {
                console.error('Logout error:', error);
            }
        }
        // Always clear local state and update UI
        this.user = null;
        this.updateAuthUI();
        document.getElementById('authContainer').classList.remove('hidden');
        document.getElementById('mainContainer').classList.add('hidden');
        this.hideHeaderMenu();
        this.showToast(this.t('loggedOut'));
    }

    // Show auth error
    showAuthError(message) {
        const errorEl = document.getElementById('authError');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }

    // Hide auth error
    hideAuthError() {
        document.getElementById('authError').classList.add('hidden');
    }

    // Initialize app after authentication
    async init() {
        this.initTheme();
        this.initEventListeners();
        
        // Check for navigation target from localStorage (e.g., from quote click)
        this.checkNavigationTarget();
        
        // Find most recent entry date from both diary entries and polls
        if (!this.user || this.user.is_anonymous === true) {
            const [recentEntry, recentPoll] = await Promise.all([
                this.supabase
                    .from('diary_entries')
                    .select('date')
                    .order('date', { ascending: false })
                    .limit(1)
                    .single(),
                this.supabase
                    .from('polls')
                    .select('date')
                    .order('date', { ascending: false })
                    .limit(1)
                    .single()
            ]);
            
            // Determine the most recent date between entries and polls
            let mostRecentDate = null;
            
            if (recentEntry?.data?.date && recentPoll?.data?.date) {
                // Both exist, choose the more recent one
                mostRecentDate = recentEntry.data.date > recentPoll.data.date ? recentEntry.data.date : recentPoll.data.date;
            } else if (recentEntry?.data?.date) {
                // Only entry exists
                mostRecentDate = recentEntry.data.date;
            } else if (recentPoll?.data?.date) {
                // Only poll exists
                mostRecentDate = recentPoll.data.date;
            }
            
            if (mostRecentDate) {
                const [year, month] = mostRecentDate.split('-').map(Number);
                this.currentDate = new Date(year, month - 1, 1);
                this.selectedDate = mostRecentDate;
            } else {
                this.selectedDate = this.formatDateKey(new Date());
            }
        }
        
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.updateUI();
        
        if (this.user) {
            this.initPushNotifications();
        }

        this.handleNotificationClick();
        this.showEntries(this.selectedDate);
    }

    // Handle notification click from service worker
    handleNotificationClick() {
        // console.log('handleNotificationClick called');
        // console.log('Current URL:', window.location.href);
        
        const params = new URLSearchParams(window.location.search);
        const date = params.get('date');
        const entryId = params.get('entryId');
        
        // console.log('URL params - date:', date, 'entryId:', entryId);
        
        if (date) {
            // console.log('Navigating to date from notification:', date, 'entryId:', entryId);
            const [year, month] = date.split('-').map(Number);
            this.currentDate = new Date(year, month - 1, 1);
            this.selectedDate = date;
            this.loadEntriesForMonth(year, month - 1).then(() => {
                this.renderCalendar();
                this.showEntries(date);
                this.entriesSection.classList.remove('hidden');
                if (entryId) {
                    // console.log('Looking for entryId:', entryId);
                    // console.log('Available entries:', this.entries[date]);
                    // console.log('Available entry IDs:', this.entries[date]?.map(e => e.id));
                    this.scrollToEntry(entryId);
                }
            });
            window.history.replaceState({}, '', '/');
        }
        
        // Listen for messages from service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                // console.log('Received SW message:', event.data);
                if (event.data.type === 'OPEN_ENTRY') {
                    const { date, entryId } = event.data;
                    // console.log('Processing OPEN_ENTRY message:', date, entryId);
                    if (date) {
                        const [year, month] = date.split('-').map(Number);
                        this.currentDate = new Date(year, month - 1, 1);
                        this.selectedDate = date;
                        this.loadEntriesForMonth(year, month - 1).then(() => {
                            this.renderCalendar();
                            this.showEntries(date);
                            this.entriesSection.classList.remove('hidden');
                            if (entryId) {
                                this.scrollToEntry(entryId);
                            }
                        });
                    }
                }
            });
        }
    }

    // Check localStorage for navigation target (e.g., from quote click)
    checkNavigationTarget() {
        const navData = localStorage.getItem('navigateTo');
        if (!navData) return;
        
        try {
            const { date, entryId, timestamp } = JSON.parse(navData);
            
            // Navigation target expires after 10 seconds
            if (Date.now() - timestamp > 10000) {
                localStorage.removeItem('navigateTo');
                return;
            }

            // Clear navigation target so it doesn't repeat
            localStorage.removeItem('navigateTo');
            
            // Navigate to entry
            if (date) {
                const [year, month] = date.split('-').map(Number);
                this.currentDate = new Date(year, month - 1, 1);
                this.selectedDate = date;
                
                this.loadEntriesForMonth(year, month - 1).then(() => {
                    this.renderCalendar();
                    this.showEntries(date);
                    
                    if (entryId) {
                        setTimeout(() => {
                            const entryEl = document.querySelector(`[data-entry-id="${entryId}"]`);
                            if (entryEl) {
                                const entryItem = entryEl.closest('.entry-item');
                                if (entryItem) {
                                    this.scrollToEntry(entryId);
                                }
                            }
                        }, 500);
                    }
                });
            }
        } catch (e) {
            localStorage.removeItem('navigateTo');
        }
    }
            
    // Update notification button state
    async updateNotificationButtonState() {
        const notificationsBtn = document.getElementById('notificationsBtn');
        const { data } = await this.supabase
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', this.user.id)
            .maybeSingle();
        
        this.isNotificationsEnabled = !!data;
        const icon = notificationsBtn.querySelector('i');
        const span = notificationsBtn.querySelector('span');
        
        if (this.isNotificationsEnabled) {
            icon.className = 'bi bi-bell-slash';
            span.setAttribute('data-i18n', 'turnOffNotifications');
            span.textContent = this.t('turnOffNotifications');
        } else {
            icon.className = 'bi bi-bell';
            span.setAttribute('data-i18n', 'turnOnNotifications');
            span.textContent = this.t('turnOnNotifications');
        }
    }

    // Toggle notifications
    async toggleNotifications() {
        this.hideHeaderMenu();
        if (!this.user || this.user.is_anonymous === true) return;
        
        if (this.isNotificationsEnabled) {
            await this.unsubscribeFromNotifications();
        } else {
            await this.subscribeToNotifications();
        }
    }

    // Subscribe to notifications
    async subscribeToNotifications() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            alert(this.t('alertPushNotificationsNotSupported'));
            return;
        }

        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert(this.t('alertNotificationsDenied'));
                return;
            }

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
            }

            const { error } = await this.supabase
                .from('push_subscriptions')
                .insert({
                    user_id: this.user.id,
                    subscription: subscription.toJSON()
                });

            if (error) throw error;
            
            await this.updateNotificationButtonState();
            this.showToast(this.t('notificationsEnabled'));
        } catch (error) {
            console.error('Failed to subscribe:', error);
            alert(this.t('alertFailedToEnableNotifications'));
        }
    }

    // Unsubscribe from notifications
    async unsubscribeFromNotifications() {
        try {
            const { error } = await this.supabase
                .from('push_subscriptions')
                .delete()
                .eq('user_id', this.user.id);

            if (error) throw error;
            
            await this.updateNotificationButtonState();
            this.showToast(this.t('notificationsDisabled'));
        } catch (error) {
            console.error('Failed to unsubscribe:', error);
            alert(this.t('alertFailedToDisableNotifications'));
        }
    }

    // Initialize push notifications
    async initPushNotifications() {
        const hasDismissed = localStorage.getItem('notificationBannerDismissed');
        if (hasDismissed) return;
        
        const { data } = await this.supabase
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', this.user.id)
            .maybeSingle();
        
        if (data) return; // Already subscribed
        
        // Show banner for new users
        if (Notification.permission !== 'denied') {
            this.showNotificationBanner();
        }
    }

    // Show notification banner
    showNotificationBanner() {
        const banner = document.getElementById('notificationBanner');
        banner.innerHTML = `
            <div class="notification-banner">
                <div class="notification-banner-content">
                    <i class="bi bi-bell notification-banner-icon"></i>
                    <span class="notification-banner-text">${this.t('notificationBannerText')}</span>
                </div>
                <div class="notification-banner-actions">
                    <button class="notification-banner-btn primary" id="enableNotificationsBtn">
                        ${this.t('enableNotifications')}
                    </button>
                    <button class="notification-banner-btn secondary" id="dismissBannerBtn">
                        ${this.t('notNow')}
                    </button>
                </div>
            </div>
        `;
        
        document.getElementById('enableNotificationsBtn').addEventListener('click', () => {
            this.hideNotificationBanner();
            this.subscribeToNotifications();
        });
        
        document.getElementById('dismissBannerBtn').addEventListener('click', () => {
            this.hideNotificationBanner();
        });
    }

    // Hide notification banner
    hideNotificationBanner() {
        const banner = document.getElementById('notificationBanner');
        banner.innerHTML = '';
        localStorage.setItem('notificationBannerDismissed', 'true');
    }

    // Convert VAPID key
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    // Send push notification to all users except author
    async sendPushNotification(type, entryId = null) {
        return;
        if (!this.user || this.user.is_anonymous === true) return;

        try {
            await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    username: this.user.user_metadata?.username || 'Someone',
                    userId: this.user.id,
                    type: type,
                    date: this.selectedDate,
                    entryId: entryId
                })
            });
        } catch (error) {
            console.error('Failed to send push notification:', error);
        }
    }

    // Initialize theme
    initTheme() {
        const savedTheme = localStorage.getItem('theme');
        const theme = savedTheme || 'dark';
        
        document.documentElement.setAttribute('data-theme', theme);
        this.themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }

    // Cache DOM element references
    initElements() {
        this.calendarDays = document.getElementById('calendarDays');
        this.currentMonthEl = document.getElementById('currentMonth');
        this.prevMonthBtn = document.getElementById('prevMonth');
        this.nextMonthBtn = document.getElementById('nextMonth');
        this.todayBtn = document.getElementById('todayBtn');
        this.entriesSection = document.getElementById('entriesSection');
        this.selectedDateTitle = document.getElementById('selectedDateTitle');
        this.addEntryBtn = document.getElementById('addEntryBtn');
        this.addImageBtn = document.getElementById('addImageBtn');
        // this.shareDayBtn = document.getElementById('shareDayBtn');
        this.yearSelect = document.getElementById('yearSelect');
        this.monthSelect = document.getElementById('monthSelect');
        this.imageModal = document.getElementById('imageModal');
        this.imageModalClose = document.getElementById('imageModalClose');
        this.modalImage = document.getElementById('modalImage');
        this.mobileImageOptions = document.getElementById('mobileImageOptions');
        this.fileInput = document.getElementById('fileInput');
        this.cameraInput = document.getElementById('cameraInput');
        this.imageContextMenu = document.getElementById('imageContextMenu');
        this.currentImageUrl = null;
        this.currentImageEntryId = null;
        this.entryForm = document.getElementById('entryForm');
        this.entryTextarea = document.getElementById('entryTextarea');
        this.saveEntryBtn = document.getElementById('saveEntryBtn');
        this.clearEntryBtn = document.getElementById('clearEntryBtn');
        this.entryList = document.getElementById('entryList');
        this.entryNavigation = document.getElementById('entryNavigation');
        this.prevEntryBtn = document.getElementById('prevEntryBtn');
        this.nextEntryBtn = document.getElementById('nextEntryBtn');
        this.searchInput = document.getElementById('searchInput');
        this.searchInput.setAttribute('autocomplete', 'new-password');
        this.searchInput.setAttribute('readonly', 'readonly');
        setTimeout(() => this.searchInput.removeAttribute('readonly'), 100);
        this.searchResults = document.getElementById('searchResults');
        this.headerMenuToggle = document.getElementById('headerMenuToggle');
        this.headerDropdown = document.getElementById('headerDropdown');
        this.toggleThemeBtn = document.getElementById('toggleThemeBtn');
        this.themeIcon = document.getElementById('themeIcon');
        this.signOutBtn = document.getElementById('signOutBtn');
        this.resetEmail = document.getElementById('resetEmail');
        this.replyButton = document.getElementById('replyButton');
        this.aiBtn = document.getElementById('aiBtn');
        this.aiForm = document.getElementById('aiForm');
        this.aiTextarea = document.getElementById('aiTextarea');
        this.savePromptBtn = document.getElementById('savePromptBtn');
        this.clearPromptBtn = document.getElementById('clearPromptBtn');
        this.lengthSelect = document.getElementById('lengthSelect');
        
        // Poll elements
        this.pollForm = document.getElementById('pollForm');
        this.pollQuestion = document.getElementById('pollQuestion');
        this.pollOptionsContainer = document.querySelector('.poll-options');
        this.savePollBtn = document.getElementById('savePollBtn');
        this.clearPollBtn = document.getElementById('clearPollBtn');
        this.addPollBtn = document.getElementById('addPollBtn');

        // Apply display mode styles
        this.applyDisplayModeStyles();
    }

    // Set up event listeners
    initEventListeners() {
        this.prevMonthBtn.addEventListener('click', () => this.changeMonth(-1));
        this.nextMonthBtn.addEventListener('click', () => {
            if (this.canNavigateToFuture(1)) this.changeMonth(1);
        });
        this.todayBtn.addEventListener('click', () => this.goToToday());
        this.initSwipeAndWheelNavigation();
        this.prevEntryBtn.addEventListener('click', () => this.navigateEntry(-1));
        this.nextEntryBtn.addEventListener('click', () => this.navigateEntry(1));
        this.initEntrySwipeNavigation();
        this.addEntryBtn.addEventListener('click', () => {
            if (!this.user || this.user.is_anonymous === true) return alert(this.t('signInToAddEntries'));
            this.showEntryForm();
        });
        this.addImageBtn.addEventListener('click', () => {
            if (!this.user || this.user.is_anonymous === true) return alert(this.t('signInToAddImages'));
            // Reset currentEntryId to ensure a new entry is created
            this.currentEntryId = null;
            this.handleImageUpload();
        });
        // this.shareDayBtn.addEventListener('click', () => this.shareDay());
        this.imageModalClose.addEventListener('click', () => this.closeImageModal());
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // Only create a new entry if we're not attaching to an existing entry
                if (!this.currentEntryId) {
                    this.createEntryForImageUpload();
                }
                this.processImageFile(file);
            }
        });
        this.cameraInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // Only create a new entry if we're not attaching to an existing entry
                if (!this.currentEntryId) {
                    this.createEntryForImageUpload();
                }
                this.processImageFile(file);
            }
        });
        document.getElementById('selectImageBtn').addEventListener('click', () => this.fileInput.click());
        document.getElementById('cameraBtn').addEventListener('click', () => this.cameraInput.click());
        document.getElementById('cancelImageBtn').addEventListener('click', () => this.hideMobileOptions());
        document.getElementById('shareImageBtn').addEventListener('click', () => this.shareImage());
        document.getElementById('deleteImageBtn').addEventListener('click', () => this.confirmImageDelete());
        document.getElementById('shareImageModalBtn').addEventListener('click', () => {
            const entry = this.entries[this.selectedDate]?.find(e => e.id === this.currentImageEntryId);
            if (entry) {
                this.shareImage(this.selectedDate, entry);
            }
        });
        document.getElementById('deleteImageModalBtn').addEventListener('click', () => this.confirmImageDelete());
        document.getElementById('cancelImageActionsBtn').addEventListener('click', () => this.hideImageActionsModal());
        this.saveEntryBtn.addEventListener('click', () => this.doneEntry());
        this.clearEntryBtn.addEventListener('click', () => this.hideEntryForm());
        // this.entryTextarea.addEventListener('keyup', (e) => {
        //     if (e.key === 'Enter' && e.ctrlKey) {
        //         this.doneEntry();
        //     }
        // });
        // Debounced search input to reduce DB queries
        this._debouncedSearch = this.debounce((e) => this.handleSearch(e.target.value), 300);
        this.searchInput.addEventListener('input', this._debouncedSearch);

        // Event delegation for entry actions and image clicks
        if (this.entryList) {
            this.entryList.addEventListener('click', (e) => {
                const menuBtn = e.target.closest('.menu-btn');
                if (menuBtn) {
                    e.stopPropagation();
                    const entryId = menuBtn.dataset.entryId;
                    const date = menuBtn.dataset.date;
                    const entries = this.entries[date] || [];
                    const entry = entries.find(en => en.id === entryId);
                    if (entry && entry.type === 'poll') {
                        // if (menuBtn.dataset.userId !== this.user?.id) {
                        //     menuBtn.classList.add('hidden');
                        // } else {
                            this.showPollActionsModal(entryId, date);
                        // }
                    } else {
                        this.showEntryActionsModal(entryId, date);
                    }
                    return;
                }

                const img = e.target.closest('.image-thumbnail');
                if (img) {
                    const src = img.dataset?.src || img.src;
                    if (src) this.showImageModal(src);
                    return;
                }

                const likeBtn = e.target.closest('.btn-like');
                if (likeBtn) {
                    e.stopPropagation();
                    const entryId = likeBtn.dataset.entryId;
                    this.handleLikeDislike(entryId, true);
                    return;
                }

                const dislikeBtn = e.target.closest('.btn-dislike');
                if (dislikeBtn) {
                    e.stopPropagation();
                    const entryId = dislikeBtn.dataset.entryId;
                    this.handleLikeDislike(entryId, false);
                    return;
                }
            });

            // Delegate poll radio changes
            this.entryList.addEventListener('change', (e) => {
                const input = e.target.closest('input[type="radio"]');
                if (!input) return;
                const name = input.name || '';
                if (name.startsWith('poll-')) {
                    const pollId = name.replace('poll-', '');
                    const optionId = input.value;
                    this.voteOnPoll(pollId, optionId);
                }
            });
        }
        this.headerMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleHeaderMenu();
        });
        this.toggleThemeBtn.addEventListener('click', () => this.toggleTheme());
        document.getElementById('signInBtn').addEventListener('click', () => this.showSignIn());
        document.getElementById('footerSignInLink').addEventListener('click', () => this.showSignIn());
        document.getElementById('accountBtn').addEventListener('click', () => this.showAccountModal());
        document.getElementById('peopleBtn').addEventListener('click', () => this.showPeopleModal());
        this.signOutBtn.addEventListener('click', () => this.signOut());
        this.aiBtn.addEventListener('click', () => {
            if (!this.user && this.user.email !== 'kaydansky@gmail.com' && this.user.email !== 'info@kaydansky.ru') return alert(this.t('Куды?..'));
            this.showAiPromptForm();
        });
        this.clearPromptBtn.addEventListener('click', () => this.hideAiForm());
        this.savePromptBtn.addEventListener('click', () => this.generateAiPrompt());
        document.getElementById('shareEntryModalBtn').addEventListener('click', () => this.handleEntryAction('share'));
        document.getElementById('copyEntryModalBtn').addEventListener('click', () => this.handleEntryAction('copy'));
        document.getElementById('imageEntryModalBtn').addEventListener('click', () => this.handleEntryAction('image'));
        document.getElementById('editEntryModalBtn').addEventListener('click', () => this.handleEntryAction('edit'));
        document.getElementById('deleteEntryModalBtn').addEventListener('click', () => this.handleEntryAction('delete'));
        document.getElementById('imagePollModalBtn').addEventListener('click', () => this.handleEntryAction('image'));
        document.getElementById('sharePollModalBtn').addEventListener('click', () => this.handleEntryAction('share'));
        document.getElementById('deletePollModalBtn').addEventListener('click', () => this.handleEntryAction('delete'));
        document.getElementById('cancelEntryActionsBtn').addEventListener('click', () => this.hideEntryActionsModal());
        document.getElementById('cancelPollActionsBtn').addEventListener('click', () => this.hidePollActionsModal());
        document.getElementById('languageBtn').addEventListener('click', () => this.showLanguageModal());
        document.getElementById('cancelLanguageBtn').addEventListener('click', () => this.hideLanguageModal());
        document.querySelectorAll('#languageModal [data-lang]').forEach(btn => {
            btn.addEventListener('click', () => this.changeLanguage(btn.dataset.lang));
        });
        document.getElementById('deleteAllEntriesBtn').addEventListener('click', () => this.deleteAllEntries());
        document.getElementById('deleteAllImagesBtn').addEventListener('click', () => this.deleteAllImages());
        document.getElementById('deleteAccountBtn').addEventListener('click', () => this.deleteAccountConfirm());
        document.getElementById('cancelAccountBtn').addEventListener('click', () => this.hideAccountModal());
        document.getElementById('cancelPeopleBtn').addEventListener('click', () => this.hidePeopleModal());
        // document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());
        document.addEventListener('click', () => this.hideHeaderMenu());
        this.yearSelect.addEventListener('change', () => this.resetMonthSelect());
        this.monthSelect.addEventListener('change', () => this.jumpToDate());
        this.populateDateSelects();
        document.getElementById('forgotPasswordLink').addEventListener('click', () => this.showResetPasswordModal());
        document.getElementById('sendResetBtn').addEventListener('click', () => this.sendPasswordReset());
        document.getElementById('cancelResetBtn').addEventListener('click', () => this.hideResetPasswordModal());
        document.getElementById('updatePasswordBtn').addEventListener('click', () => this.updatePassword());
        document.getElementById('cancelUpdatePasswordBtn').addEventListener('click', () => this.hideUpdatePasswordModal());
        document.getElementById('changeUsernameBtn').addEventListener('click', () => this.showChangeUsernameModal());
        document.getElementById('updateUsernameBtn').addEventListener('click', () => this.updateUsername());
        document.getElementById('cancelUsernameBtn').addEventListener('click', () => this.hideChangeUsernameModal());
        document.getElementById('notificationsBtn').addEventListener('click', () => this.toggleNotifications());
        document.getElementById('shareAppBtn').addEventListener('click', () => this.shareApp());
        document.getElementById('howItWorksBtn').addEventListener('click', () => this.showHowItWorksModal());
        document.getElementById('closeHowItWorksBtn').addEventListener('click', () => this.hideHowItWorksModal());
        document.getElementById('replyButton').addEventListener('click', () => this.showEntryForm());
        
        // Poll event listeners
        this.addPollBtn.addEventListener('click', () => {
            if (!this.user || this.user.is_anonymous === true) return alert(this.t('alertSignInToCreatePoll'));
            this.showPollForm();
        });
        
        this.savePollBtn.addEventListener('click', () => this.savePoll());
        this.clearPollBtn.addEventListener('click', () => this.hidePollForm());
        
        // Add event listener for dynamically adding option fields
        this.pollOptionsContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('poll-option-input')) {
                this.handleOptionInput(e.target);
            }
        });

        // Register all modals with the modal manager
        this.registerModals();
    }

    // Register all modals for centralized management
    registerModals() {
        // Entry/Poll actions modals (no special callbacks needed)
        this.modalManager.register('entryActions', 'entryActionsModal');
        this.modalManager.register('pollActions', 'pollActionsModal');
        this.modalManager.register('imageActions', 'imageActionsModal');
        this.modalManager.register('image', 'imageModal', null, () => {
            URL.revokeObjectURL(this.modalImage.src);
            this.removeModalCloseHandlers();
        });

        // Account & Auth modals
        this.modalManager.register('language', 'languageModal', () => this.hideHeaderMenu());
        this.modalManager.register('account', 'accountModal', () => this.hideHeaderMenu());
        this.modalManager.register('resetPassword', 'resetPasswordModal', null, () => {
            this.resetEmail.value = '';
        });
        this.modalManager.register('updatePassword', 'updatePasswordModal', null, () => {
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmNewPassword').value = '';
            document.getElementById('newUsername').value = '';
        });
        this.modalManager.register('changeUsername', 'changeUsernameModal', () => {
            this.hideAccountModal();
            document.getElementById('newUsername').value = this.user?.user_metadata?.username || '';
            document.getElementById('newUsername').focus();
        }, () => {
            document.getElementById('newUsername').value = '';
        });

        // Info modals
        this.modalManager.register('howItWorks', 'howItWorksModal', () => this.hideHeaderMenu());
        this.modalManager.register('people', 'peopleModal', null, () => this.hideHeaderMenu());
    }

    // Load entries for specific month from Supabase
    async loadEntriesForMonth(year, month, forceReload = false) {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

        // Return cached month if available (deep clone to avoid accidental mutations)
        if (this._monthCache && this._monthCache.has(monthKey) && !forceReload) {
            try {
                this.entries = JSON.parse(JSON.stringify(this._monthCache.get(monthKey)));
            } catch (e) {
                this.entries = Object.assign({}, this._monthCache.get(monthKey));
            }
            // Compute and return the last date that has a diary entry (or any entry as fallback)
            const cachedDates = Object.keys(this.entries).sort().reverse();
            for (const d of cachedDates) {
                const items = this.entries[d] || [];
                if (items.some(i => i.type === 'entry')) return d;
            }
            for (const d of cachedDates) {
                if ((this.entries[d] || []).length > 0) return d;
            }
            return null;
        }

        this.showLoadingOverlay();
        try {
            const lastDay = new Date(year, month + 1, 0).getDate();
            
            // Load diary entries and include parent entry data (if any)
            const { data: entriesData } = await this.supabase
                .from('diary_entries')
                .select('*, parent_entry:parent_entry_id (id, username, created_at, text)')
                .gte('date', `${monthKey}-01`)
                .lte('date', `${monthKey}-${String(lastDay).padStart(2, '0')}`)
                .order('date', { ascending: true });

            this.entries = {};
            entriesData?.forEach(entry => {
                if (!this.entries[entry.date]) this.entries[entry.date] = [];
                this.entries[entry.date].push({
                    id: entry.id,
                    user_id: entry.user_id,
                    username: entry.username || null,
                    text: entry.text,
                    images: entry.images || [],
                    createdAt: entry.created_at,
                    updatedAt: entry.updated_at,
                    originalText: entry.text,
                    originalImages: [...(entry.images || [])],
                    type: 'entry',
                    parentEntry: entry.parent_entry ? {
                        id: entry.parent_entry.id,
                        username: entry.parent_entry.username || null,
                        text: this.truncateQuote(entry.parent_entry.text) || null,
                        createdAt: entry.parent_entry.created_at
                    } : null
                });
            });

            // Load polls for the month
            const { data: pollsData } = await this.supabase
                .from('polls')
                .select(`
                    id,
                    user_id,
                    question,
                    date,
                    created_at,
                    username,
                    images,
                    poll_options (
                        id,
                        option_text,
                        position
                    )
                `)
                .gte('date', `${monthKey}-01`)
                .lte('date', `${monthKey}-${String(lastDay).padStart(2, '0')}`)
                .order('date', { ascending: true });

            // Add polls to entries
            pollsData?.forEach(poll => {
                const pollDate = poll.date;
                if (!this.entries[pollDate]) this.entries[pollDate] = [];
                
                // Format options with vote counts (will be updated when votes are loaded)
                const options = poll.poll_options.map(option => ({
                    id: option.id,
                    text: option.option_text,
                    position: option.position,
                    votes: 0 // Will be updated when votes are loaded
                })).sort((a, b) => a.position - b.position);
                
                this.entries[pollDate].push({
                    id: poll.id,
                    user_id: poll.user_id,
                    question: poll.question,
                    options: options,
                    createdAt: poll.created_at,
                    username: poll.username || null,
                    images: poll.images || [],
                    type: 'poll'
                });
            });

            // Load vote counts for all polls
            const pollIds = pollsData?.map(poll => poll.id) || [];
            if (pollIds.length > 0) {
                // Get vote counts for all options in these polls
                const { data: voteCounts, error } = await this.supabase
                    .rpc('get_poll_vote_counts', { poll_ids: pollIds });
                
                // Update vote counts in the entries
                voteCounts?.forEach(voteCount => {
                    // Find the poll and option to update
                    for (const date in this.entries) {
                        const poll = this.entries[date].find(entry =>
                            entry.type === 'poll' &&
                            entry.options.some(option => option.id === voteCount.option_id)
                        );
                        
                        if (poll) {
                            const option = poll.options.find(opt => opt.id === voteCount.option_id);
                            if (option) {
                                option.votes = voteCount.vote_count || 0;
                                break;
                            }
                        }
                    }
                });
                
                // Load user votes for these polls
                if (this.user) {
                    const { data: userVotes, error: userVotesError } = await this.supabase
                        .from('poll_votes')
                        .select('poll_id, option_id, user_id')
                        .in('poll_id', pollIds)
                        .eq('user_id', this.user.id);
                    
                    // Add user votes to poll entries
                    if (userVotes) {
                        userVotes.forEach(userVote => {
                            for (const date in this.entries) {
                                const poll = this.entries[date].find(entry =>
                                    entry.type === 'poll' && entry.id === userVote.poll_id
                                );
                                
                                if (poll) {
                                    poll.userVote = userVote;
                                    break;
                                }
                            }
                        });
                    }
                }
            }

            await this.loadLikeDislikeData();

            // Cache loaded month data (deep copy)
            try {
                this._monthCache.set(monthKey, JSON.parse(JSON.stringify(this.entries)));
            } catch (e) {
                this._monthCache.set(monthKey, Object.assign({}, this.entries));
            }
        } finally {
            this.hideLoadingOverlay();
            await this.broadcast();
        }

        // After loading, return the last date in the month that has a diary entry.
        const loadedDates = Object.keys(this.entries).sort().reverse();
        for (const d of loadedDates) {
            const items = this.entries[d] || [];
            if (items.some(i => i.type === 'entry')) return d;
        }
        // Fallback: return the last date that has any entries (including polls)
        for (const d of loadedDates) {
            if ((this.entries[d] || []).length > 0) return d;
        }
        return null;
    }

    async loadLikeDislikeData() {
        const entryIds = [];
        for (const date in this.entries) {
            for (const entry of this.entries[date]) {
                if (entry.type === 'entry' && entry.id && entry.id.includes('-')) {
                    entryIds.push(entry.id);
                }
            }
        }

        if (entryIds.length === 0) return;

        try {
            const [counts, userStatuses] = await Promise.all([
                this.likeDislikeManager.getCounts(entryIds),
                this.likeDislikeManager.getUserStatus(entryIds)
            ]);

            for (const date in this.entries) {
                for (const entry of this.entries[date]) {
                    if (entry.type !== 'entry') continue;

                    const countData = counts.find(c => c.entry_id === entry.id);
                    const statusData = userStatuses.find(s => s.entry_id === entry.id);

                    entry.likesCount = countData?.likes_count || 0;
                    entry.dislikesCount = countData?.dislikes_count || 0;
                    entry.userVote = statusData?.is_like ?? null;
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки лайков/дизлайков:', error);
        }
    }

    // Save entries to Supabase
    async saveEntries() {
        // Only save entries for the current selected date
        const entries = this.entries[this.selectedDate];
        if (!entries || entries.length === 0) return;

        // Save only entries that have been modified (new or edited)
        for (const entry of entries) {
            if (entry.type !== 'entry') continue; // Skip polls

            const payload = {
                user_id: this.user.id,
                username: this.user.user_metadata?.username || null,
                date: this.selectedDate,
                text: entry.text,
                images: entry.images || [],
                updated_at: new Date().toISOString()
            };

            let needsSave = false;

            // If entry has a UUID (contains hyphens), it's an existing entry from database
            if (entry.id && entry.id.includes('-')) {
                payload.id = entry.id;

                // Check if text changed
                const textChanged = entry.originalText !== undefined && entry.text !== entry.originalText;
                
                // Check if images array changed (simple but effective: compare JSON strings)
                const originalImages = entry.originalImages || [];
                const imagesChanged = JSON.stringify(originalImages) !== JSON.stringify(entry.images || []);

                needsSave = textChanged || imagesChanged;

                if (!needsSave) {
                    continue; // No changes → skip
                }
            } else {
                // New entry → always save
                needsSave = true;
            }
            
            const { data } = await this.supabase
                .from('diary_entries')
                .upsert(payload)
                .select();
            
            // Update the entry ID if it was a new entry
            if (data && data[0] && (!entry.id || !entry.id.includes('-'))) {
                entry.id = data[0].id;
            }
            
            // Update originalText and originalImages after successful save
            entry.originalText = entry.text;
            entry.originalImages = [...(entry.images || [])]; // deep copy
        }
        // Invalidate cached month for the selected date so next fetch reads fresh data
        try {
            const monthKey = this.selectedDate.slice(0,7); // YYYY-MM
            if (this._monthCache && this._monthCache.has(monthKey)) this._monthCache.delete(monthKey);
        } catch (e) {
            // ignore
        }
    }

    // Handle search input
    async handleSearch(query) {
        if (!query || !query.trim()) {
            this.searchResults.classList.add('hidden');
            return;
        }

        const q = query.trim();

        // Run both queries in parallel
        const [entriesResult, pollsResult] = await Promise.all([
            this.supabase
                .from('diary_entries')
                .select('*')
                .ilike('text', `%${q}%`)
                .limit(10),
            this.supabase
                .from('polls')
                .select('*')
                .ilike('question', `%${q}%`)
                .limit(10)
        ]);

        // Combine results from both queries
        const diaryEntries = entriesResult.data || [];
        const polls = pollsResult.data || [];
        const data = [...diaryEntries, ...polls];

        if (data.length === 0) {
            this.searchResults.innerHTML = '<div class="no-entries">' + this.t('noResults') + '</div>';
            this.searchResults.classList.remove('hidden');
            return;
        }

        this.searchResults.innerHTML = data.map(result => {
            // Determine if this is an entry or poll
            const isPoll = result.question !== undefined;
            const preview = isPoll
                ? result.question.substring(0, 100)
                : result.text.substring(0, 100);
            const previewWithEllipsis = preview.length > 100 ? preview + '...' : preview;
            return `
                <div class="search-result-item" data-date="${result.date}" data-entry-id="${result.id}">
                    <div class="search-result-date">${this.formatDate(result.date)}</div>
                    <div class="search-result-text">${this.escapeHtml(previewWithEllipsis)}</div>
                </div>
            `;
        }).join('');

        // Use event delegation on searchResults container
        this.searchResults.removeEventListener('click', this._searchResultsClick);
        this._searchResultsClick = async (e) => {
            const item = e.target.closest('.search-result-item');
            if (!item) return;
            const date = item.dataset.date;
            const entryId = item.dataset.entryId;
            const [year, month, day] = date.split('-').map(Number);
            this.currentDate = new Date(year, month - 1, day);
            this.selectedDate = date;
            this.searchQuery = q;
            await this.loadEntriesForMonth(year, month - 1);
            this.showEntries(date);
            this.scrollToEntry(entryId);
            this.searchInput.value = '';
            this.searchResults.classList.add('hidden');
        };
        this.searchResults.addEventListener('click', this._searchResultsClick);

        this.searchResults.classList.remove('hidden');
    }

    async handleLikeDislike(entryId, isLike) {
        if (!this.user) {
            alert(this.t('signInToLike'));
            return;
        }
        
        const entryEl = document.querySelector(`.entry-item[data-entry-id="${entryId}"]`);
        if (!entryEl) return;

        const currentStatus = entryEl.dataset.userVote === 'true' ? true : 
                             entryEl.dataset.userVote === 'false' ? false : null;

        try {
            const newStatus = await this.likeDislikeManager.toggleVote(entryId, currentStatus, isLike);
            const entry = this.entries[this.selectedDate]?.find(e => e.id === entryId);
            
            if (entry) {
                // Update user's vote status
                const prevStatus = entry.userVote;
                entry.userVote = newStatus;
                
                // Update counters
                if (prevStatus === true) entry.likesCount = (entry.likesCount || 0) - 1;
                if (prevStatus === false) entry.dislikesCount = (entry.dislikesCount || 0) - 1;
                if (newStatus === true) entry.likesCount = (entry.likesCount || 0) + 1;
                if (newStatus === false) entry.dislikesCount = (entry.dislikesCount || 0) + 1;
                
                // If vote was removed (newStatus === null), counters are already decremented above
            }

            // Refresh UI
            entryEl.dataset.userVote = newStatus === null ? '' : newStatus;
            
            // Refresh button states
            const likeBtn = entryEl.querySelector('.btn-like');
            const dislikeBtn = entryEl.querySelector('.btn-dislike');
            
            likeBtn.classList.toggle('active', newStatus === true);
            dislikeBtn.classList.toggle('active', newStatus === false);
            
            // Refresh icons
            likeBtn.querySelector('i').className = newStatus === true ? 'bi bi-hand-thumbs-up-fill' : 'bi bi-hand-thumbs-up';
            dislikeBtn.querySelector('i').className = newStatus === false ? 'bi bi-hand-thumbs-down-fill' : 'bi bi-hand-thumbs-down';
            
            // Refresh counters
            await this.refreshLikeDislikeCounts([entryId]);
            
        } catch (error) {
            console.error('Vote error:', error);
            this.showToast(this.t('voteError'));
        }
    }

    async refreshLikeDislikeCounts(entryIds) {
        if (!entryIds || entryIds.length === 0) return;

        try {
            const [counts, userStatuses] = await Promise.all([
                this.likeDislikeManager.getCounts(entryIds),
                this.likeDislikeManager.getUserStatus(entryIds)
            ]);

            for (const entryId of entryIds) {
                const entryEl = document.querySelector(`.entry-item[data-entry-id="${entryId}"]`);
                if (!entryEl) continue;

                const countData = counts.find(c => c.entry_id === entryId);
                const userStatus = userStatuses.find(s => s.entry_id === entryId);
                const entry = this.entries[this.selectedDate]?.find(e => e.id === entryId);
                
                if (entry) {
                    entry.likesCount = countData?.likes_count || 0;
                    entry.dislikesCount = countData?.dislikes_count || 0;
                    entry.userVote = userStatus?.is_like ?? null;
                }

                // Refesh counters in UI
                const likeBtn = entryEl.querySelector('.btn-like');
                const dislikeBtn = entryEl.querySelector('.btn-dislike');
                
                if (likeBtn) {
                    likeBtn.querySelector('.count').textContent = countData?.likes_count || 0;
                    likeBtn.classList.toggle('filled', (countData?.likes_count || 0) > 0);
                }
                if (dislikeBtn) {
                    dislikeBtn.querySelector('.count').textContent = countData?.dislikes_count || 0;
                    dislikeBtn.classList.toggle('filled', (countData?.dislikes_count || 0) > 0);
                }

                // Refresh user vote status
                if (userStatus !== undefined) {
                    entryEl.dataset.userVote = userStatus.is_like ? 'true' : 'false';
                    
                    // Update visual state of buttons
                    if (likeBtn) likeBtn.classList.toggle('active', userStatus.is_like === true);
                    if (dislikeBtn) dislikeBtn.classList.toggle('active', userStatus.is_like === false);
                    
                    // Refresh icons
                    if (likeBtn) likeBtn.querySelector('i').className = userStatus.is_like ? 'bi bi-hand-thumbs-up-fill' : 'bi bi-hand-thumbs-up';
                    if (dislikeBtn) dislikeBtn.querySelector('i').className = userStatus.is_like === false ? 'bi bi-hand-thumbs-down-fill' : 'bi bi-hand-thumbs-down';
                }
            }
        } catch (error) {
            console.error('Ошибка обновления счётчиков:', error);
        }
    }

    // Compress image with adaptive quality based on original size
    async compressImage(blob, maxWidth = 1920, maxHeight = 1920) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            img.onload = () => {
                try {
                    let { width, height } = img;
                    
                    // Resize if dimensions exceed max
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Adaptive quality: larger images get lower quality to reduce final size
                    const originalSize = blob.size;
                    let quality = 0.8; // Default quality
                    
                    if (originalSize > 5 * 1024 * 1024) {
                        // > 5MB: compress harder
                        quality = 0.6;
                    } else if (originalSize > 2 * 1024 * 1024) {
                        // > 2MB: compress moderately
                        quality = 0.7;
                    }
                    
                    canvas.toBlob((compressedBlob) => {
                        if (!compressedBlob) {
                            reject(new Error('Canvas compression failed'));
                            return;
                        }
                        resolve(compressedBlob);
                    }, 'image/jpeg', quality);
                } catch (err) {
                    reject(err);
                }
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(blob);
        });
    }

    // Save image to Supabase Storage
    async saveImage(blob) {
        const fileName = `${this.user.id}/${Date.now()}.jpg`;
        
        const { data } = await this.supabase.storage
            .from('diary-images')
            .upload(fileName, blob);

        const { data: { publicUrl } } = this.supabase.storage
            .from('diary-images')
            .getPublicUrl(fileName);

        return publicUrl;
    }

    // Get image from Supabase Storage
    async getImage(imageUrl) {
        return fetch(imageUrl).then(r => r.blob());
    }

    // Check if navigation to future month is allowed
    canNavigateToFuture(direction) {
        if (direction <= 0) return true;
        const today = new Date();
        const nextMonth = new Date(this.currentDate);
        nextMonth.setMonth(nextMonth.getMonth() + direction);
        return nextMonth <= today;
    }

    // Show a full-screen loading overlay with spinner and disable UI
    showLoadingOverlay() {
        if (this._loadingOverlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = 'loadingOverlay';

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';

        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = (this.t && this.t('loading')) || 'Loading...';

        spinner.appendChild(sr);
        overlay.appendChild(spinner);
        document.body.appendChild(overlay);

        this._loadingOverlay = overlay;
        document.body.setAttribute('aria-busy', 'true');
        const main = document.getElementById('mainContainer');
        if (main) main.setAttribute('aria-hidden', 'true');
        if (document.activeElement) document.activeElement.blur();
    }

    // Hide loading overlay and re-enable UI
    hideLoadingOverlay() {
        if (!this._loadingOverlay) return;
        this._loadingOverlay.remove();
        this._loadingOverlay = null;
        document.body.removeAttribute('aria-busy');
        const main = document.getElementById('mainContainer');
        if (main) main.removeAttribute('aria-hidden');
    }

    // Navigate to previous or next month
    async changeMonth(direction) {
        if (!this.canNavigateToFuture(direction)) return;
        
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        const lastEntryDate = await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        if (lastEntryDate) {
            this.selectedDate = lastEntryDate;
            this.renderEntries(this.selectedDate);
        }
        this.renderCalendar();
    }

    // Jump to today's date
    async goToToday() {
        this.currentDate = new Date();
        this.selectedDate = this.formatDateKey(new Date());
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.renderCalendar();
        this.showEntries(this.selectedDate);
    }

    // Populate date selects
    populateDateSelects() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        
        for (let year = 1993; year <= currentYear; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            this.yearSelect.appendChild(option);
        }
        this.yearSelect.value = currentYear;
        
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = this.t('selectMonth');
        placeholder.disabled = true;
        placeholder.selected = true;
        this.monthSelect.appendChild(placeholder);
        
        for (let month = 0; month < 12; month++) {
            const option = document.createElement('option');
            option.value = month;
            option.textContent = this.t('months')[month];
            this.monthSelect.appendChild(option);
        }
        this.monthSelect.value = currentMonth;
    }

    // Update date selects
    updateDateSelects() {
        if (this.selectedDate) {
            const [year, month] = this.selectedDate.split('-').map(Number);
            this.yearSelect.value = year;
            this.monthSelect.value = month - 1;
        }
    }

    // Reset month select to placeholder
    resetMonthSelect() {
        this.monthSelect.value = '';
    }

    // Jump to selected date
    async jumpToDate() {
        if (this.monthSelect.value === '') return;
        const year = parseInt(this.yearSelect.value);
        const month = parseInt(this.monthSelect.value);
        this.currentDate = new Date(year, month, 1);
        await this.loadEntriesForMonth(year, month);
        this.renderCalendar();
        
        // Find the first entry in the month and focus on that date
        let firstEntryDate = null;
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        // Sort the dates to find the earliest one with entries
        const sortedDates = Object.keys(this.entries)
            .filter(date => date.startsWith(monthKey))
            .sort();
            
        if (sortedDates.length > 0) {
            firstEntryDate = sortedDates[0];
        } else {
            // If no entries, default to first day of month
            firstEntryDate = this.formatDateKey(new Date(year, month, 1));
        }
        
        this.selectedDate = firstEntryDate;
        this.showEntries(this.selectedDate);
    }

    // Render the calendar grid
    renderCalendar() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        this.currentMonthEl.textContent = `${this.t('months')[month]} ${year}`;
        this.nextMonthBtn.disabled = !this.canNavigateToFuture(1);

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const frag = document.createDocumentFragment();
        const temp = document.createElement('div');
        const today = new Date();
        const todayStr = this.formatDateKey(today);

        for (let i = firstDay - 1; i >= 0; i--) {
            temp.innerHTML = `<div class="day other-month">${daysInPrevMonth - i}</div>`;
            frag.appendChild(temp.firstElementChild);
            temp.innerHTML = '';
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateKey === todayStr;
            const isSelected = dateKey === this.selectedDate;
            const hasEntries = this.entries[dateKey] && this.entries[dateKey].length > 0;
            const isFuture = dateKey > todayStr;

            let classes = 'day';
            if (isFuture) {
                classes += ' future';
            } else {
                if (isToday) classes += ' today';
                if (isSelected) classes += ' selected';
                if (hasEntries) classes += ' has-entries';
            }

            temp.innerHTML = `<div class="${classes}" data-date="${dateKey}">${day}</div>`;
            frag.appendChild(temp.firstElementChild);
            temp.innerHTML = '';
        }

        const remainingCells = 42 - (firstDay + daysInMonth);
        for (let day = 1; day <= remainingCells; day++) {
            temp.innerHTML = `<div class="day other-month">${day}</div>`;
            frag.appendChild(temp.firstElementChild);
            temp.innerHTML = '';
        }

        this.calendarDays.innerHTML = '';
        this.calendarDays.appendChild(frag);

        // Use delegated click handler on calendarDays to avoid re-adding listeners
        if (!this._calendarClickHandler) {
            this._calendarClickHandler = (e) => {
                const day = e.target.closest('.day:not(.other-month):not(.future)');
                if (!day) return;
                const date = day.dataset.date;
                this.selectedDate = date;
                this.renderCalendar();
                this.showEntries(date);
            };
            this.calendarDays.addEventListener('click', this._calendarClickHandler);
        }
    }

    // Convert Date object to YYYY-MM-DD string
    formatDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // Convert YYYY-MM-DD string to readable date
    formatDate(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const weekday = this.t('weekdaysFull')[date.getDay()];
        const monthName = this.t('months')[month - 1];
        return `${weekday}, ${monthName} ${day}, ${year}`;
    }
    
    // Format time remaining until poll expiration as "days hours minutes seconds"
    formatTimeRemaining(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        if (seconds <= 0) return this.t('pollExpired');

        const days = Math.floor(seconds / (24 * 60 * 60));
        const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
        const minutes = Math.floor((seconds % (60 * 60)) / 60);
        const secs = seconds % 60;

        return `${this.t('pollExpDate')} ${days} ${this.t('shortD')} ${hours} ${this.t('shortH')} ${minutes} ${this.t('shortM')} ${secs} ${this.t('shortS')}`;
    }
    
    // Check if poll has expired
    isPollExpired(poll) {
        if (!poll.createdAt) return false;
        const pollCreationTime = new Date(poll.createdAt).getTime();
        const currentTime = new Date().getTime();
        const timeElapsed = (currentTime - pollCreationTime) / 1000; // Convert to seconds
        return timeElapsed > POLL_LIFETIME_SECONDS;
    }

    // Display entries section
    showEntries(date) {
        this.entriesSection.classList.remove('hidden');
        this.selectedDateTitle.textContent = this.formatDate(date);
        this.renderEntries(date);
        this.updateDateSelects();
    }

    // Render list of entries
    renderEntries(date) {
        const entries = this.entries[date] || [];
        this.toggleAddPollBtn();

        // Sort entries by timestamp ascending (oldest first, newest last)
        entries.sort((a, b) => {
            const timeA = new Date(a.createdAt || 0).getTime();
            const timeB = new Date(b.createdAt || 0).getTime();
            return timeA - timeB;
        });
        
        // this.shareDayBtn.style.display = entries.length === 0 ? 'none' : 'flex';
        this.updateEntryNavigation();

        if (entries.length === 0) {
            const message = this.t('noEntries');
            this.entryList.innerHTML = `<li class="no-entries">${message}</li>`;
            this.toggleReplyButton();
            return;
        }
        
        // Build entries using DocumentFragment with DOM factories (no HTML templates)
        const frag = document.createDocumentFragment();

        for (const entry of entries) {
            const el = entry.type === 'poll' ? this.createPollElement(entry, date) : this.createEntryElement(entry, date);
            frag.appendChild(el);
        }
        
        // Clear and append fragment in one reflow
        this.entryList.innerHTML = '';
        this.entryList.appendChild(frag);

        // Load images lazily for entries
        entries.forEach(entry => {
            if (entry.images && entry.images.length > 0) {
                this.loadEntryImages(entry.id, entry.images);
            }
        });

        this.searchQuery = '';

        // Initialize poll countdown timers and start updates (single update manager)
        this.updatePollCountdowns(entries);

        this.toggleReplyButton();
    }

    // Check if a date is earlier than today
    isDateEarlierThanToday(dateString) {
        // Get today's date in YYYY-MM-DD format (local time zone)
        const today = new Date();
        const todayStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        return dateString < todayStr;
    }

    toggleReplyButton() {
        if (!this.user || this.user.is_anonymous === true) return;

        // Hide reply button if entry form is shown
        if (!this.entryForm.classList.contains('hidden')) {
            this.replyButton.classList.add('hidden');
            return;
        }
        
        if (document.activeElement === this.entryTextarea) {
            this.replyButton.classList.add('hidden');
            return;
        }

        if (this.entries && this.entries[this.selectedDate] && this.entries[this.selectedDate].length > 0) {
            this.replyButton.classList.remove('hidden');
        } else {
            this.replyButton.classList.add('hidden');
        }
    }

    toggleAddPollBtn() {
        if (!this.user || this.user.is_anonymous === true) return;

        if (this.isDateEarlierThanToday(this.selectedDate)) {
            this.addPollBtn.style.display = 'none';
        } else if (this.user) {
            this.addPollBtn.style.display = 'flex';
        }
    }

    // Update poll countdowns in real-time
    updatePollCountdowns(entries) {
        let pollCountdowns = new Map();
        const currentPollIds = new Set();
        entries.forEach(entry => {
            if (entry.type === 'poll' && entry.createdAt) {
                currentPollIds.add(entry.id);
            }
        });

        // Clear intervals for polls no longer displayed
        for (const [pollId, intervalId] of pollCountdowns.entries()) {
            if (!currentPollIds.has(pollId)) {
                clearInterval(intervalId);
                pollCountdowns.delete(pollId);
            }
        }

        // Set up intervals for visible polls
        entries.forEach(entry => {
            if (entry.type !== 'poll' || !entry.createdAt) return;

            const pollElement = document.querySelector(
            `.entry-item[data-poll-id="${entry.id}"]`
            );

            if (!pollElement) return;

            const countdownEl = pollElement.querySelector(
                `.poll-countdown[data-poll-id="${entry.id}"]`
            );

            if (!countdownEl) return;

            const isExpired = this.isPollExpired(entry);

            // Clear an old interval for already expired polls
            if (pollCountdowns.has(entry.id) && isExpired) {
                clearInterval(pollCountdowns.get(entry.id));
                pollCountdowns.delete(entry.id);
            }

            if (!isExpired && !pollCountdowns.has(entry.id)) {
                const intervalId = setInterval(() => {
                    const nowExpired = this.isPollExpired(entry);
                    if (nowExpired) {
                        countdownEl.textContent = this.t('pollExpired');
                        countdownEl.classList.add('poll-expired');
                        clearInterval(intervalId);
                        pollCountdowns.delete(entry.id);
                        return;
                    }

                    const pollCreationTime = new Date(entry.createdAt).getTime();
                    const expirationTime = pollCreationTime + POLL_LIFETIME_SECONDS * 1000;
                    const currentTime = Date.now();
                    const timeLeft = expirationTime - currentTime;
                    const timeRemaining = this.formatTimeRemaining(timeLeft);
                    countdownEl.textContent = timeRemaining;
                }, 1000);

                pollCountdowns.set(entry.id, intervalId);
            } else if (isExpired) {
                countdownEl.textContent = this.t('pollExpired');
                countdownEl.classList.add('poll-expired');
            }
        });
    }


    // DOM factory for creating entry element (avoids innerHTML per entry)
    createEntryElement(entry, date) {
        const li = document.createElement('li');
        li.className = 'entry-item';
        li.setAttribute('data-entry-id', entry.id);
        li.dataset.userVote = entry.userVote === true ? 'true' : entry.userVote === false ? 'false' : '';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'entry-content';

        // Render Parent Entry Quote if exists
        if (entry.parentEntry) {
            const quote = document.createElement('div');
            quote.className = 'reply-quote';

            const date = entry.parentEntry.createdAt 
            ? new Date(entry.parentEntry.createdAt).toLocaleDateString('ru-Ru', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
            + ' ' + new Date(entry.parentEntry.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false }) 
            : '';
            
            const author = document.createElement('span');
            author.className = 'reply-quote-author';
            author.innerHTML = `— ${this.escapeHtml(entry.parentEntry.username)}<br>${date}`;
            
            const text = document.createElement('div');
            text.className = 'reply-quote-text';
            text.textContent = entry.parentEntry.text;
            
            quote.appendChild(author);
            quote.appendChild(text);
            contentDiv.appendChild(quote);

            // Make quote clickable to navigate to parent entry
            quote.style.cursor = 'pointer';
            quote.addEventListener('click', () => {
                const parentDate = entry.parentEntry.createdAt 
                    ? new Date(entry.parentEntry.createdAt).toISOString().split('T')[0]
                    : null;
                if (parentDate && entry.parentEntry.id) {
                    // Navigate to parent entry using in-app routing (preserves mobile styles)
                    const [year, month, day] = parentDate.split('-').map(Number);
                    this.currentDate = new Date(year, month - 1, day);
                    this.selectedDate = parentDate;
                    this.loadEntriesForMonth(year, month - 1).then(() => {
                        this.renderCalendar();
                        this.showEntries(parentDate);
                        this.entriesSection.classList.remove('hidden');
                        this.scrollToEntry(entry.parentEntry.id);
                    });
                }
            });
        }

        // Add author and time if present
        if (entry.username) {
            const authorDiv = document.createElement('div');
            authorDiv.className = 'entry-author';
            authorDiv.innerHTML = `— ${this.escapeHtml(entry.username)} <br> `;

            const timeSpan = document.createElement('span');
            timeSpan.className = 'entry-time';
            if (entry.createdAt) {
                const dateStr = new Date(entry.createdAt).toLocaleDateString('ru-Ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const timeStr = new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                timeSpan.textContent = `${dateStr} ${timeStr}`;
            }
            authorDiv.appendChild(timeSpan);
            contentDiv.appendChild(authorDiv);
        }

        // Entry text
        const textDiv = document.createElement('div');
        textDiv.className = 'entry-text';
        if (this.searchQuery) {
            textDiv.innerHTML = this.highlightText(entry.text, this.searchQuery);
        } else {
            textDiv.innerHTML = this.escapeHtml(entry.text);
        }
        contentDiv.appendChild(textDiv);

        // Images container
        const imagesDiv = document.createElement('div');
        imagesDiv.className = 'entry-images';
        imagesDiv.id = `images-${entry.id}`;
        contentDiv.appendChild(imagesDiv);

        li.appendChild(contentDiv);

        // Entry actions
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'entry-actions';

        const likeBtn = document.createElement('button');
        likeBtn.className = `btn-like ${entry.userVote === true ? 'active' : ''} ${(entry.likesCount || 0) > 0 && (entry.userVote !== true) ? 'filled' : ''}`;
        likeBtn.setAttribute('data-entry-id', entry.id);
        likeBtn.setAttribute('title', this.t('like'));
        likeBtn.innerHTML = `<i class="bi bi-hand-thumbs-up${entry.userVote === true ? '-fill' : ''}"></i> <span class="count">${entry.likesCount || 0}</span>`;

        const dislikeBtn = document.createElement('button');
        dislikeBtn.className = `btn-dislike ${entry.userVote === false ? 'active' : ''} ${(entry.dislikesCount || 0) > 0 && (entry.userVote !== false) ? 'filled' : ''}`;
        dislikeBtn.setAttribute('data-entry-id', entry.id);
        dislikeBtn.setAttribute('title', this.t('dislike'));
        dislikeBtn.innerHTML = `<i class="bi bi-hand-thumbs-down${entry.userVote === false ? '-fill' : ''}"></i> <span class="count">${entry.dislikesCount || 0}</span>`;

        actionsDiv.appendChild(likeBtn);
        actionsDiv.appendChild(dislikeBtn);

        const menuBtn = document.createElement('button');
        menuBtn.className = 'menu-btn';
        menuBtn.setAttribute('data-entry-id', entry.id);
        menuBtn.setAttribute('data-date', date);
        menuBtn.title = this.t('entryOptions');
        menuBtn.innerHTML = '<i class="bi bi-three-dots-vertical"></i>';

        actionsDiv.appendChild(menuBtn);
        li.appendChild(actionsDiv);

        return li;
    }

    // Scroll to and highlight the parent entry
    scrollToEntry(entryId) {
        setTimeout(() => {
            const entryEl = document.querySelector(`.entry-item[data-entry-id="${entryId}"]`);
            const pollEl = document.querySelector(`.poll-item[data-poll-id="${entryId}"]`);
            const elToScroll = entryEl || pollEl;

            if (elToScroll) {
                elToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
                elToScroll.classList.add('highlight');
                setTimeout(() => elToScroll.classList.remove('highlight'), 2000);
            }
        }, 100);
    }

    // Render a diary entry (legacy method, now uses factory)
    renderEntry(entry, date) {
        const entryText = this.searchQuery ? this.highlightText(entry.text, this.searchQuery) : this.escapeHtml(entry.text);
        const entryTime = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('ru-Ru', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        
        return `
            <li class="entry-item">
                <div class="entry-content">
                    ${entry.username ? `<div class="entry-author">— ${this.escapeHtml(entry.username)} <br> <span class="entry-time">${entryTime}</span></div>` : ''}
                    <div class="entry-text">${entryText}</div>
                    <div class="entry-images" id="images-${entry.id}"></div>
                </div>
                <div class="entry-actions">
                    <button class="menu-btn" data-entry-id="${entry.id}" data-date="${date}" title="` + this.t('entryOptions') + `">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                </div>
            </li>
        `;
    }

    // DOM factory for creating poll element (avoids innerHTML per poll)
    createPollElement(poll, date) {
        const li = document.createElement('li');
        li.className = 'entry-item poll-item';
        li.setAttribute('data-poll-id', poll.id);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'entry-content';

        // Add author and time if present
        if (poll.username) {
            const authorDiv = document.createElement('div');
            authorDiv.className = 'entry-author';

            const pollTime = poll.createdAt ? new Date(poll.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            authorDiv.innerHTML = `— ${this.escapeHtml(poll.username)} &bull; ${pollTime} <br> `;

            const countdownSpan = document.createElement('span');
            countdownSpan.className = 'poll-countdown';
            countdownSpan.setAttribute('data-poll-id', poll.id);

            const isExpired = this.isPollExpired(poll);
            if (!isExpired && poll.createdAt) {
                const pollCreationTime = new Date(poll.createdAt).getTime();
                const expirationTime = pollCreationTime + (POLL_LIFETIME_SECONDS * 1000);
                const timeLeft = expirationTime - Date.now();
                countdownSpan.textContent = this.formatTimeRemaining(timeLeft);
            } else {
                countdownSpan.innerHTML = `<span class="poll-expired">${this.t('pollExpired')}</span>`;
            }

            authorDiv.appendChild(countdownSpan);
            contentDiv.appendChild(authorDiv);
        }

        // Poll question
        const questionDiv = document.createElement('div');
        questionDiv.className = 'poll-question';
        questionDiv.textContent = poll.question;
        contentDiv.appendChild(questionDiv);

        // Images container
        const imagesDiv = document.createElement('div');
        imagesDiv.className = 'entry-images';
        imagesDiv.id = `images-${poll.id}`;
        contentDiv.appendChild(imagesDiv);

        // Poll options
        const optionsDiv = document.createElement('div');
        optionsDiv.className = 'poll-options';

        const isExpired = this.isPollExpired(poll);
        poll.options.forEach(option => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'poll-option';

            const labelEl = document.createElement('label');
            labelEl.className = 'poll-option-label';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `poll-${poll.id}`;
            input.value = option.id;

            if (this.user 
                && this.user.id === poll.user_id 
                && poll.userVote 
                && poll.userVote.option_id === option.id 
                && poll.userVote.user_id === this.user.id) {
                input.checked = true;
            } 
            if (isExpired) {
                input.disabled = true;
            }

            const optionText = document.createElement('span');
            optionText.className = 'poll-option-text';
            optionText.textContent = option.text;

            const voteCount = document.createElement('span');
            voteCount.className = 'poll-vote-count';
            voteCount.textContent = option.votes || 0;

            labelEl.appendChild(input);
            labelEl.appendChild(optionText);
            labelEl.appendChild(voteCount);

            optionDiv.appendChild(labelEl);
            optionsDiv.appendChild(optionDiv);
        });

        contentDiv.appendChild(optionsDiv);
        li.appendChild(contentDiv);

        // Poll actions (only show menu for owner)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'entry-actions';

        // if (this.user && poll.user_id === this.user.id) {
            const menuBtn = document.createElement('button');
            menuBtn.className = 'menu-btn';
            menuBtn.setAttribute('data-entry-id', poll.id);
            menuBtn.setAttribute('data-date', date);
            menuBtn.setAttribute('data-user-id', poll.user_id);
            menuBtn.title = this.t('entryOptions');
            menuBtn.innerHTML = '<i class="bi bi-three-dots-vertical"></i>';
            actionsDiv.appendChild(menuBtn);
        // }

        li.appendChild(actionsDiv);
        return li;
    }

    // Render a poll (legacy method, now uses factory)
    renderPoll(poll, date) {
        const pollTime = poll.createdAt ? new Date(poll.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        
        // Check if poll has expired
        const isExpired = this.isPollExpired(poll);
        
        // Calculate expiration countdown if poll has creation time
        const pollCreationTime = new Date(poll.createdAt).getTime();
        const expirationTime = pollCreationTime + (POLL_LIFETIME_SECONDS * 1000);
        const timeLeft = expirationTime - Date.now();
        
        const optionsHtml = poll.options.map(option => {
            // Check if user has voted for this option
            let checkedAttr = '';
            
;            if (this.user && this.user.id === poll.user_id && poll.userVote && poll.userVote.option_id === option.id) {
                checkedAttr = 'checked="true"';
            }
            
            // Add disabled attribute if poll is expired
            const disabledAttr = isExpired ? 'disabled' : '';
            
            return `
            <div class="poll-option">
                <label class="poll-option-label">
                    <input type="radio" name="poll-${poll.id}" value="${option.id}" ${checkedAttr} ${disabledAttr}>
                    <span class="poll-option-text">${this.escapeHtml(option.text)}</span>
                    <span class="poll-vote-count">${option.votes}</span>
                </label>
            </div>
        `}).join('');
        
        return `
            <li class="entry-item poll-item" data-poll-id="${poll.id}">
                <div class="entry-content">
                    ${poll.username ? `
                        <div class="entry-author">— ${this.escapeHtml(poll.username)} &bull; ${pollTime} <br> 
                            <span class="poll-countdown" data-poll-id="${poll.id}">
                                ${!isExpired ? this.formatTimeRemaining(timeLeft) : `<span class="poll-expired">${this.t('pollExpired')}</span>`}
                            </span>
                        </div>` : ''}
                    <div class="poll-question">${this.escapeHtml(poll.question)}</div>
                    <div class="poll-options">
                        ${optionsHtml}
                    </div>
                </div>
                <div class="entry-actions">${this.user && poll.user_id === this.user.id ? `
                    <button class="menu-btn" data-entry-id="${poll.id}" data-date="${date}" data-user-id="${poll.user_id}" title="` + this.t('entryOptions') + `">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button> ` : ``} 
                </div>
            </li>
        `;
    }

    // Vote on a poll
    async voteOnPoll(pollId, optionId) {
        // if (!this.user) {
        //     alert(this.t('alertSignInToVote'));
        //     this.renderEntries(this.selectedDate);
        //     return;
        // }

        if (!this.user) {
            try {
                // Attempt anonymous sign-in
                const { data, error } = await this.supabase.auth.signInAnonymously();
                if (error) throw error;
                
                // Update local user state
                this.user = data.user;
                
                // Refresh UI to reflect logged-in status
                this.updateAuthUI();
                
            } catch (err) {
                console.error('Anonymous auth failed:', err);
                alert(this.t('alertSignInToVote'));
                return;
            }
        }

        try {
            // Check if user has already voted
            const { data: existingVote } = await this.supabase
                .from('poll_votes')
                .select('id')
                .eq('poll_id', pollId)
                .eq('user_id', this.user.id)
                .maybeSingle();

            if (existingVote) {
                alert(this.t('alertAlreadyVoted'));
                // Re-render to show the current state
                this.renderEntries(this.selectedDate);
                return;
            }

            if (!confirm(this.t('confirmVote'))) {
                // Re-render to reset the selected radio button
                this.renderEntries(this.selectedDate);
                return;
            }

            // Insert the vote
            const { error } = await this.supabase
                .from('poll_votes')
                .insert({
                    poll_id: pollId,
                    option_id: optionId,
                    user_id: this.user.id
                });

            if (error) throw error;

            // Update local entries data with the user's vote
            const entries = this.entries[this.selectedDate] || [];
            const poll = entries.find(entry => entry.type === 'poll' && entry.id === pollId);
            
            if (poll) {
                // Add user vote to the poll object
                poll.userVote = {
                    poll_id: pollId,
                    option_id: optionId
                };
                
                // Update vote count for the selected option
                const option = poll.options.find(opt => opt.id === optionId);
                if (option) {
                    option.votes = (option.votes || 0) + 1;
                }
            }

            // Update the poll display with new vote count
            this.renderEntries(this.selectedDate);
        } catch (error) {
            console.error('Error voting on poll:', error);
            alert(this.t('alertFailedToVote'));
        }
    }

    // Show entry form
    async showEntryForm() {
        await this.broadcast();
        this.originalText = this.entryTextarea.value;
        this.autoSaveEntryId = null;
        this.entryForm.classList.remove('hidden');
        this.entryTextarea.focus();
        this.pollForm.classList.add('hidden');
        this.replyButton.classList.add('hidden');
    }

    // Hide entry form
    clearEntryForm(hideForm = true) {
        if (hideForm) {
            this.entryForm.classList.add('hidden');
        }
        
        this.entryTextarea.value = '';
        this.editingEntryId = null;
        this.originalText = '';
        this.autoSaveEntryId = null;
    }

    // Show poll form
    showPollForm() {
        this.pollForm.classList.remove('hidden');
        this.pollQuestion.focus();
        this.entryForm.classList.add('hidden');
    }

    // Handle option input for poll
    handleOptionInput(target) {
        const optionsContainer = target.closest('.poll-options');
        const optionInputs = optionsContainer.querySelectorAll('.poll-option-input');
        const lastInput = optionInputs[optionInputs.length - 1];
        
        // If the last input has text and it's the one being typed in, add a new input
        if (lastInput.value.trim() !== '' && target === lastInput) {
            const newOption = document.createElement('div');
            newOption.className = 'poll-option';
            newOption.innerHTML = '<input type="text" class="poll-option-input" placeholder="' + (optionInputs.length + 1) + '" maxlength="100">';
            optionsContainer.appendChild(newOption);
        }
        
        // If the target is empty and not the last input, remove the last empty input
        if (target.value.trim() === '' && target !== lastInput && optionInputs.length > 2) {
            const emptyInputs = Array.from(optionInputs).filter(input => input.value.trim() === '');
            if (emptyInputs.length > 1) {
                const lastEmpty = emptyInputs[emptyInputs.length - 1];
                if (lastEmpty !== optionInputs[0] && lastEmpty !== optionInputs[1]) {
                    lastEmpty.parentElement.remove();
                }
            }
        }
    }

    hideEntryForm() {
        this.entryForm.classList.add('hidden');
        this.entryTextarea.value = '';
        this.editingEntryId = null;
        this.originalText = '';
        this.autoSaveEntryId = null;
        this.toggleReplyButton();
    }

    // Hide poll form
    hidePollForm() {
        this.pollForm.classList.add('hidden');
        this.pollQuestion.value = '';
        
        // Clear all option inputs except the first two
        const optionInputs = this.pollOptionsContainer.querySelectorAll('.poll-option-input');
        for (let i = 0; i < optionInputs.length; i++) {
            if (i < 2) {
                optionInputs[i].value = '';
            } else {
                optionInputs[i].closest('.poll-option').remove();
            }
        }
    }

    hideAiForm() {
        this.aiForm.classList.add('hidden');
        this.aiTextarea.value = '';
    }

    // Save poll to Supabase
    async savePoll() {
        const question = this.pollQuestion.value.trim();
        const optionInputs = this.pollOptionsContainer.querySelectorAll('.poll-option-input');
        
        // Validate question (max 200 characters)
        if (!question) {
            alert(this.t('alertNoQuestion'));
            return;
        }
        
        if (question.length > 200) {
            alert(this.t('alertTooLongQuestion'));
            return;
        }
        
        // Collect and validate options (max 100 characters each, at least 2 non-empty options)
        const options = [];
        for (const input of optionInputs) {
            const value = input.value.trim();
            if (value) {
                if (value.length > 100) {
                    alert(this.t('alertTooLongOption'));
                    return;
                }
                options.push(value);
            }
        }
        
        if (options.length < 2) {
            alert(this.t('alertMinOptions'));
            return;
        }
        
        // Disable save button and show loading state
        this.savePollBtn.disabled = true;
        this.savePollBtn.classList.add('spinning');
        
        try {
            // Insert poll into polls table
            const { data: pollData, error: pollError } = await this.supabase
                .from('polls')
                .insert({
                    question: question,
                    user_id: this.user.id,
                    date: this.selectedDate,
                    username: this.user.user_metadata?.username || null,
                })
                .select()
                .single();
            
            if (pollError) throw pollError;
            
            // Insert options into poll_options table
            const optionsData = options.map((option, index) => ({
                poll_id: pollData.id,
                option_text: option,
                position: index + 1
            }));
            
            const { data: optionsInsertData, error: optionsError } = await this.supabase
                .from('poll_options')
                .insert(optionsData)
                .select();
            
            if (optionsError) throw optionsError;
            
            // Add the new poll to the entries object so it appears immediately
            const newPoll = {
                id: pollData.id,
                user_id: this.user.id,
                question: question,
                options: optionsInsertData.map(optionData => ({
                    id: optionData.id, // Use actual database ID
                    text: optionData.option_text,
                    position: optionData.position,
                    votes: 0
                })),
                createdAt: new Date().toISOString(),
                username: this.user.user_metadata?.username || null,
                type: 'poll'
            };
            
            // Initialize the date array if it doesn't exist
            if (!this.entries[this.selectedDate]) {
                this.entries[this.selectedDate] = [];
            }
            
            // Add the new poll to the entries
            this.entries[this.selectedDate].push(newPoll);
            
            // Reset form and hide it
            this.hidePollForm();
            this.showToast(this.t('pollCreated'));
            // Reload month to ensure consistency
            this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth(), true);
            this.renderEntries(this.selectedDate);
        } catch (error) {
            console.error('Error saving poll:', error);
            alert(this.t('alertFailedToCreatePoll'));
        } finally {
            // Re-enable save button and remove loading state
            this.savePollBtn.disabled = false;
            this.savePollBtn.classList.remove('spinning');
        }
    }

    // Finish editing entry
    doneEntry() {
        const text = this.entryTextarea.value.trim();
        if (text) {
            this.saveEntry();
        } else {
            this.clearEntryForm(false);
        }
    }

    // Save entry
    async saveEntry() {
        const text = this.entryTextarea.value.trim();
        if (!text) return;
        if (text.length > 1000) {
            alert(this.t('entryTextMaxLength'));
            return;
        }

        // Show spinner and disable buttons
        this.saveEntryBtn.disabled = true;
        this.clearEntryBtn.disabled = true;
        this.saveEntryBtn.classList.add('spinning');

        const payload = {
            user_id: this.user.id,
            username: this.user.user_metadata?.username || null,
            date: this.selectedDate,
            text: text,
            parent_entry_id: this.parentEntry?.id || null // Include parent ID if replying
        };

        if (this.editingEntryId) {
            const entryRef = this.entries[this.selectedDate].find(e => e.id === this.editingEntryId);
            payload.id = this.editingEntryId;
            payload.updated_at = new Date().toISOString();
            
            // Check if text changed
            const textChanged = entryRef.originalText !== undefined && text !== entryRef.originalText;
            
            if (!textChanged) {
                return; // No changes → skip
            }

            entryRef.text = text;
            entryRef.originalText = text;
        } else if (this.parentEntry) {
            payload.date = this.selectedDate = this.formatDateKey(new Date()); // Replies are always for today
        }

        try {
            const { data, error } = await this.supabase
                .from('diary_entries')
                .upsert(payload)
                .select()
                .single();

            if (error) throw error;

            // Add new entry to local state immediately
            if (!this.editingEntryId) {
                if (!this.entries[this.selectedDate]) this.entries[this.selectedDate] = [];
                this.entries[this.selectedDate].push({
                    id: data.id,
                    type: 'entry',
                    user_id: data.user_id,
                    username: data.username,
                    text: data.text,
                    createdAt: data.created_at,
                    parentEntry: this.parentEntry || null,
                    originalText: data.text,
                    originalImages: [...(data.images || [])] // deep copy
                });
            }

            this.parentEntry = null; // Reset reply state
            this.showEntries(this.selectedDate);

            // Restore buttons
            this.saveEntryBtn.classList.remove('spinning');
            this.saveEntryBtn.disabled = false;
            this.clearEntryBtn.disabled = false;
            this.clearEntryForm(false);

            // Invalidate cached month for the selected date so next fetch reads fresh data
            try {
                const monthKey = this.selectedDate.slice(0,7); // YYYY-MM
                if (this._monthCache && this._monthCache.has(monthKey)) this._monthCache.delete(monthKey);
            } catch (e) {
                // ignore
            }

            // Focus on newly added entry
            this.scrollToEntry(data.id);

            await this.sendPushNotification('entry', data.id); // Send notification
        } catch (error) {
            console.error('Error saving entry:', error);
            this.showToast(this.t('errorSavingEntry'));
        }
    }

    // Clear entry
    async clearEntry() {
        if (this.entryTextarea.value.trim() && !confirm(this.t('undoConfirm'))) {
            return;
        }
        this.entryTextarea.value = this.originalText;
        
        if (this.editingEntryId) {
            const entry = this.entries[this.selectedDate].find(e => e.id === this.editingEntryId);
            if (entry) {
                entry.text = entry.originalText || ''; // Restore to original text
                if (entry.text.trim() === '') {
                    this.entries[this.selectedDate] = this.entries[this.selectedDate].filter(e => e.id !== this.editingEntryId);
                    if (this.entries[this.selectedDate].length === 0) {
                        delete this.entries[this.selectedDate];
                    }
                }
            }
        } else if (this.autoSaveEntryId) {
            if (this.entries[this.selectedDate]) {
                this.entries[this.selectedDate] = this.entries[this.selectedDate].filter(e => e.id !== this.autoSaveEntryId);
                if (this.entries[this.selectedDate].length === 0) {
                    delete this.entries[this.selectedDate];
                }
            }
        }
        
        this.autoSaveEntryId = null;
        
        await this.saveEntries();
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        this.entryTextarea.focus();
    }

    // Show entry actions modal (delegated to modalManager)
    showEntryActionsModal(entryId, date) {
        const entries = this.entries[date] || [];
        const entry = entries.find(e => e.id === entryId);
        
        // Only show edit/delete for own entries
        const isOwnEntry = this.user && entry && entry.user_id === this.user.id;
        document.getElementById('editEntryModalBtn').style.display = isOwnEntry ? '' : 'none';
        document.getElementById('deleteEntryModalBtn').style.display = isOwnEntry ? '' : 'none';
        document.getElementById('imageEntryModalBtn').style.display = isOwnEntry ? '' : 'none';

        document.getElementById('replyEntryModalBtn').addEventListener('click', () => {
            if (!this.user || this.user.is_anonymous === true) {
                alert(this.t('signInToAddEntries'));
                return;
            }

            this.parentEntry = {
                id: entry.id,
                username: entry.username || '',
                createdAt: entry.createdAt || '',
                text: this.truncateQuote(entry.text)
            };
            this.hideEntryActionsModal();
            this.showEntryForm();
        });
        
        this.currentEntryId = entryId;
        this.currentEntryDate = date;
        this.modalManager.show('entryActions');
    }

    // Truncate quote text for display in reply
    truncateQuote(text) {
        if (!text) return '';
        if (text.length > this.quoteMaxLength) {
            return text.substring(0, this.quoteMaxLength) + '...';
        }
        return text;
    }

    // Show poll actions modal (delegated to modalManager)
    showPollActionsModal(pollId, date) {
        const entries = this.entries[date] || [];
        const poll = entries.find(e => e.id === pollId);
        
        // Only show delete for own polls
        const isOwnPoll = this.user && poll && poll.user_id === this.user.id;
        document.getElementById('deletePollModalBtn').style.display = isOwnPoll ? '' : 'none';
        document.getElementById('imagePollModalBtn').style.display = isOwnPoll ? '' : 'none';
        
        this.currentEntryId = pollId;
        this.currentEntryDate = date;
        this.modalManager.show('pollActions');
    }

    // Hide entry actions modal (delegated to modalManager)
    hideEntryActionsModal() {
        this.modalManager.hide('entryActions');
    }

    // Hide poll actions modal (delegated to modalManager)
    hidePollActionsModal() {
        this.modalManager.hide('pollActions');
    }

    // Handle entry action
    handleEntryAction(action) {
        this.hideEntryActionsModal();
        this.hidePollActionsModal();
        
        const entries = this.entries[this.currentEntryDate] || [];
        const entry = entries.find(e => e.id === this.currentEntryId);
        
        if (action === 'share' && entry) {
            this.shareEntry(entry, this.currentEntryDate);
        } else if (action === 'copy' && entry) {
            this.copyEntryText(entry);
        } else if (action === 'edit') {
            this.editEntry(this.currentEntryId);
        } else if (action === 'delete') {
            this.deleteEntry(this.currentEntryId);
        } else if (action === 'image') {
            this.handleImageUpload();
        }
    }

    // Copy entry text
    async copyEntryText(entry) {
        if (!entry.text) {
            alert(this.t('noTextToCopy'));
            return;
        }
        
        try {
            await navigator.clipboard.writeText(entry.text);
            this.showToast(this.t('textCopied'));
        } catch (err) {
            alert(this.t('failedToCopy'));
        }
    }

    // Show toast notification
    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => document.body.removeChild(toast), 300);
        }, 3000);
    }

    // Edit entry
    editEntry(id) {
        const entry = this.entries[this.selectedDate].find(e => e.id === id);
        if (!entry) return;

        this.editingEntryId = id;
        this.autoSaveEntryId = null;
        this.entryTextarea.value = entry.text;
        this.showEntryForm();
    }

    // Delete entry
    async deleteEntry(id) {
        if (!confirm(this.t('deleteEntryConfirm'))) return;

        const entry = this.entries[this.selectedDate].find(e => e.id === id);
        
        if (entry.type === 'poll') {
            // Delete poll and related data
            await this.supabase
                .from('polls')
                .delete()
                .eq('id', id);
        } else {
            // Handle diary entry deletion (existing behavior)
            if (entry && entry.images) {
                for (const imageUrl of entry.images) {
                    await this.deleteImageFromStorage(imageUrl);
                }
            }

            await this.supabase
                .from('diary_entries')
                .delete()
                .eq('id', id);
        }

        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth(), true);
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
    }

    // Share entry
    async shareEntry(entry, dateStr) {
        const readableDate = this.formatDate(dateStr);
        const entryUrl = `https://snt-tishinka.ru/?date=${dateStr}&entryId=${entry.id}`;
        const hasText = entry.text && entry.text.trim() !== '';
        const hasQuestion = entry.type === 'poll' && entry.question && entry.question.trim() !== '';
        const hasImage = entry.images && entry.images.length > 0;
        const isPoll = entry.type === 'poll';

        if (!hasText && !hasImage && !hasQuestion) {
            alert(this.t('nothingToShare'));
            return;
        }

        // if (entry.images && entry.images.length > 0) {
        //     for (const imageUrl of entry.images) {
        //         const blob = await this.getImage(imageUrl);
        //         if (blob) {
        //             const file = new File([blob], `diary-image.jpg`, { type: 'image/jpeg' });
        //             files.push(file);
        //         }
        //     }
        // }

        const shareData = {
            title: `${this.t('appTitle')} • ${readableDate}`
        };

        if (hasText || hasQuestion) {
            const shareText = hasText 
                ? (entry.text.length > 50 ? entry.text.substring(0, 50) + '...' : entry.text) 
                : (entry.question.length > 50 ? entry.question.substring(0, 50) + '...' : entry.question);
            const titleText = isPoll ? this.t('sharedPoll') : this.t('sharedFrom');
            shareData.text = `${titleText} ${this.t('appTitle')}:\n\n«${shareText}»\n— ${entry.username}`;

            if (hasImage) {
                shareData.text += `\n\n${this.t('entryContainsImages')}`;
            }

            shareData.text += isPoll ? `\n\n${this.t('lookOnSite')}: ${entryUrl}` : `\n\n${this.t('lookOriginal')}: ${entryUrl}`;
        } else if (hasImage) {
            shareData.text = `${this.t('sharedImages')} ${this.t('appTitle')}. ${this.t('lookOnSite')}:\n\n${entryUrl}\n\n`;
        }
        
        // if (files.length > 0) {
        //     shareData.files = files;
        // }

        if (navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                console.error('Share failed:', err.message);
            }
        } else {
            // Fallback for browsers that don't support file sharing
            console.log('File sharing not supported in this browser/OS combination.');
        }
    }

    // Share day
    shareDay() {
        const entries = this.entries[this.selectedDate] || [];
        
        if (entries.length === 0) {
            alert(this.t('noEntriesToShare'));
            return;
        }
        
        const readableDate = this.formatDate(this.selectedDate);
        const separator = "\n" + "─".repeat(10) + "\n";
        const entriesText = entries.map(entry => entry.text).filter(text => text && text.trim()).join(separator);
        
        if (!entriesText.trim()) {
            alert(this.t('noTextEntriesToShare'));
            return;
        }
        
        const sharedText = `${readableDate}\n\n${entriesText}`;
        
        if (navigator.share) {
            navigator.share({
                title: `Diary • ${readableDate}`,
                text: sharedText
            }).catch(err => console.log("Share cancelled or failed", err));
        } else {
            alert(this.t('shareNotSupported'));
        }
    }

    // Handle image upload
    handleImageUpload() {
        if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
            this.showMobileOptions();
        } else {
            this.fileInput.click();
        }
    }

    // Show mobile options
    showMobileOptions() {
        this.mobileImageOptions.classList.add('show');
    }

    // Hide mobile options
    hideMobileOptions() {
        this.mobileImageOptions.classList.remove('show');
    }

    // Process image file
    async processImageFile(file) {
        if (!file) return;
        if (!this.currentEntryDate) return
        
        this.hideMobileOptions();
        const entry = this.currentEntryId ? this.entries[this.selectedDate].find(e => e.id === this.currentEntryId) : null;
        
        if (file.size > 15 * 1024 * 1024) {
            alert(this.t('imageTooLarge'));
            return;
        }
        
        try {
            // Compress image before upload (main thread compression)
            const compressedBlob = await this.compressImage(file, 1920, 1920);
            
            // Log compression ratio for diagnostics
            const ratio = ((1 - compressedBlob.size / file.size) * 100).toFixed(1);
            console.log(`Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressedBlob.size / 1024).toFixed(0)}KB (${ratio}% reduction)`);
            const imageUrl = await this.saveImage(compressedBlob);
            
            if (entry && entry.type === 'poll') {
                await this.attachImageToPoll(imageUrl, entry);
            } else {
                await this.attachImageToEntry(imageUrl);
            }
        } catch (error) {
            console.error('Error processing image:', error);
            alert(this.t('alertImageProcessingFailed'));
        }
    }

    async attachImageToPoll(imageUrl, poll) {        
        if (!poll.images) poll.images = [];
        poll.images.push(imageUrl);
        await this.supabase
            .from('polls')
            .update({ images: poll.images })
            .eq('id', poll.id);
        this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth(), true);
        this.renderEntries(this.currentEntryDate);
        this.renderCalendar();
        // await this.sendPushNotification('image', poll.id);
    }

    // Attach image to entry
    async attachImageToEntry(imageUrl) {
        let entryRef;
        
        if (this.currentEntryId) {
            const entry = this.entries[this.selectedDate].find(e => e.id === this.currentEntryId);
            if (entry) {
                if (!entry.images) entry.images = [];
                entry.images.push(imageUrl);
                entryRef = entry;
            }
            this.currentEntryId = null;
        } else {
            if (!this.entries[this.selectedDate]) {
                this.entries[this.selectedDate] = [];
            }
            
            // Check if there's already an entry for today without text
            let existingEmptyEntry = this.entries[this.selectedDate].find(e =>
                e.type === 'entry' && (!e.text || e.text.trim() === '') &&
                (!e.images || e.images.length === 0)
            );
            
            if (existingEmptyEntry) {
                // Use the existing empty entry
                if (!existingEmptyEntry.images) existingEmptyEntry.images = [];
                existingEmptyEntry.images.push(imageUrl);
                entryRef = existingEmptyEntry;
            } else {
                // Create a new entry
                const newEntry = {
                    id: Date.now().toString(),
                    user_id: this.user.id,
                    username: this.user.user_metadata?.username || null,
                    text: '',
                    images: [imageUrl],
                    type: 'entry',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                this.entries[this.selectedDate].push(newEntry);
                entryRef = newEntry;
            }
        }
        
        await this.saveEntries();
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        
        // Send push notification for image
        if (entryRef && entryRef.id) {
            await this.sendPushNotification('image', entryRef.id);
        }
    }

    // Create entry for image upload
    createEntryForImageUpload() {
        // Only create a new entry if currentEntryId is not already set
        // (which happens when uploading from entry actions)
        if (this.currentEntryId) {
            return;
        }
        
        if (!this.entries[this.selectedDate]) {
            this.entries[this.selectedDate] = [];
        }
        
        // Check if there's already an entry for today without text or images
        let existingEmptyEntry = this.entries[this.selectedDate].find(e =>
            e.type === 'entry' && (!e.text || e.text.trim() === '') &&
            (!e.images || e.images.length === 0)
        );
        
        if (!existingEmptyEntry) {
            // Create a new empty entry for the image
            const newEntry = {
                id: Date.now().toString(),
                user_id: this.user.id,
                username: this.user.user_metadata?.username || null,
                text: '',
                images: [],
                type: 'entry',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.entries[this.selectedDate].push(newEntry);
            this.currentEntryId = newEntry.id;
        } else {
            this.currentEntryId = existingEmptyEntry.id;
        }
    }
    
    // Show image modal
    async showImageModal(imageUrl) {
        this.modalImage.src = imageUrl;
        this.addModalCloseHandlers();
        this.modalManager.show('image');
    }

    // Close image modal
    closeImageModal() {
        this.modalManager.hide('image');
    }

    // Add modal close handlers
    addModalCloseHandlers() {
        this.handleEscKey = (e) => {
            if (e.key === 'Escape') this.closeImageModal();
        };
        this.handlePopState = () => {
            if (this.imageModal.classList.contains('show')) {
                this.closeImageModal();
                history.pushState(null, '', location.href);
            }
        };
        document.addEventListener('keydown', this.handleEscKey);
        window.addEventListener('popstate', this.handlePopState);
        history.pushState(null, '', location.href);
    }

    // Remove modal close handlers
    removeModalCloseHandlers() {
        if (this.handleEscKey) {
            document.removeEventListener('keydown', this.handleEscKey);
            this.handleEscKey = null;
        }
        if (this.handlePopState) {
            window.removeEventListener('popstate', this.handlePopState);
            this.handlePopState = null;
        }
    }

    // Load entry images
    async loadEntryImages(entryId, imageUrls) {
        const container = document.getElementById(`images-${entryId}`);
        if (!container) return;
        
        for (const imageUrl of imageUrls) {
            const img = document.createElement('img');
            img.className = 'image-thumbnail';
            img.dataset.src = imageUrl;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = this.t('image') || 'image';
            img.onclick = () => this.showImageModal(imageUrl);

            this.addImageDeleteHandlers(img, imageUrl, entryId);
            container.appendChild(img);

            // Create observer lazily
            if (!this._imgObserver && 'IntersectionObserver' in window) {
                this._imgObserver = new IntersectionObserver((entries, obs) => {
                    entries.forEach(en => {
                        if (en.isIntersecting) {
                            const i = en.target;
                            if (i.dataset && i.dataset.src) {
                                i.src = i.dataset.src;
                                i.removeAttribute('data-src');
                                obs.unobserve(i);
                            }
                        }
                    });
                }, { rootMargin: '200px' });
            }

            if (this._imgObserver) {
                this._imgObserver.observe(img);
            } else {
                // Fallback: set src immediately
                img.src = imageUrl;
            }
        }
    }

    // Add image delete handlers
    addImageDeleteHandlers(img, imageUrl, entryId) {
        // Check if user owns this entry
        const entry = this.entries[this.selectedDate]?.find(e => e.id === entryId);
        const isOwnEntry = this.user && entry && entry.user_id === this.user.id;

        // Only add custom handlers if user owns the entry
        // if (!isOwnEntry) return;
        
        let longPressTimer;
        
        img.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                this.showImageActionsModal(imageUrl, entryId);
            }, 600);
        });
        
        img.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });
        
        img.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        // Prevent native context menu on Android long-press
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showImageActionsModal(imageUrl, entryId);
        });

        // Also prevent oncontextmenu via attribute for extra compatibility
        img.oncontextmenu = () => false
    }

    // Show image context menu
    showImageContextMenu(e, imageUrl, entryId) {
        this.currentImageUrl = imageUrl;
        this.currentImageEntryId = entryId;
        
        const menu = this.imageContextMenu;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.add('show');
        e.stopPropagation();
    }

    // Hide image context menu
    hideImageContextMenu() {
        this.imageContextMenu.classList.remove('show');
    }

    // Show image actions modal
    showImageActionsModal(imageUrl, entryId) {
        this.currentImageUrl = imageUrl;
        this.currentImageEntryId = entryId;
        
        // Check if user owns this entry
        const entry = this.entries[this.selectedDate]?.find(e => e.id === entryId);
        const isOwnEntry = this.user && entry && entry.user_id === this.user.id;
        
        // Hide delete button if not owner or not authenticated
        document.getElementById('deleteImageModalBtn').style.display = isOwnEntry ? 'block' : 'none';
        
        this.modalManager.show('imageActions');
    }

    // Hide image actions modal
    hideImageActionsModal() {
        this.modalManager.hide('imageActions');
    }

    // Share image
    async shareImage(dateStr, entry) {
        if (!this.currentImageUrl) return;
        
        this.hideImageContextMenu();
        this.hideImageActionsModal();
        // const blob = await this.getImage(this.currentImageUrl);
        const readableDate = this.formatDate(dateStr);
        const entryUrl = `https://snt-tishinka.ru/?date=${dateStr}&entryId=${entry.id}`;
        const shareData = {
            title: `${this.t('appTitle')} • ${readableDate}`,
            text: `${this.t('sharedImages')} ${this.t('appTitle')}. ${this.t('lookOnSite')}:\n\n${entryUrl}\n\n`,
        };

        if (navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
            } catch (err) {
                console.error('Share failed:', err.message);
            }
        } else {
            // Fallback for browsers that don't support file sharing
            console.log('File sharing not supported in this browser/OS combination.');
        }
        
        // if (blob && navigator.share) {
        //     const file = new File([blob], 'diary-image.jpg', { type: 'image/jpeg' });
        //     try {
        //         await navigator.share({
        //             title: `${this.t('appTitle')} • ${readableDate}`,
        //             text: `${this.t('sharedFrom')} ${this.t('appTitle')}\n${entryUrl}\n\n`,
        //             files: [file]
        //         });
        //     } catch (err) {
        //         console.log('Share cancelled or failed', err);
        //     }
        // } else {
        //     alert(this.t('imageSharingNotSupported'));
        // }
    }

    // Confirm image deletion
    confirmImageDelete() {
        if (!this.currentImageUrl) return;
        
        this.hideImageContextMenu();
        this.hideImageActionsModal();
        if (confirm(this.t('deleteImageConfirm'))) {
            this.deleteImage(this.currentImageUrl, this.currentImageEntryId);
        }
    }

    // Delete image from storage
    async deleteImageFromStorage(imageUrl) {
        const urlParts = imageUrl.split('/object/public/diary-images/');
        if (urlParts.length > 1) {
            const filePath = decodeURIComponent(urlParts[1]);
            await this.supabase.storage
                .from('diary-images')
                .remove([filePath]);
        }
    }

    // Delete all user images from storage
    async deleteAllUserImages() {
        const { data: files } = await this.supabase.storage
            .from('diary-images')
            .list(this.user.id);
        
        if (files && files.length > 0) {
            const filePaths = files.map(file => `${this.user.id}/${file.name}`);
            await this.supabase.storage
                .from('diary-images')
                .remove(filePaths);
        }
    }

    // Delete image
    async deleteImage(imageUrl, entryId) {
        await this.deleteImageFromStorage(imageUrl);
        
        const entry = this.entries[this.selectedDate].find(e => e.id === entryId);
        const table = entry.type === 'poll' ? 'polls' : 'diary_entries';

        if (entry && entry.images) {
            entry.images = entry.images.filter(img => img !== imageUrl);
            if (entry.images.length === 0) {
                delete entry.images;
            }
            
            await this.supabase
                .from(table)
                .update({ 
                    images: entry.images || [],
                    updated_at: new Date().toISOString()
                })
                .eq('id', entryId);
            
            if ((!entry.text || entry.text.trim() === '') && !entry.images && entry.type !== 'poll') {
                await this.supabase
                    .from('diary_entries')
                    .delete()
                    .eq('id', entryId);
                    
                this.entries[this.selectedDate] = this.entries[this.selectedDate].filter(e => e.id !== entryId);
                if (this.entries[this.selectedDate].length === 0) {
                    delete this.entries[this.selectedDate];
                }
            }
        }
        
        this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth(), true);
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
    }

    // Toggle header menu
    toggleHeaderMenu() {
        this.headerDropdown.classList.toggle('show');
    }

    // Hide header menu
    hideHeaderMenu() {
        this.headerDropdown.classList.remove('show');
    }

    // Show language modal
    showLanguageModal() {
        this.modalManager.show('language');
    }

    // Hide language modal
    hideLanguageModal() {
        this.modalManager.hide('language');
    }

    // Show account modal
    showAccountModal() {
        this.modalManager.show('account');
    }

    // Hide account modal
    hideAccountModal() {
        this.modalManager.hide('account');
    }

    // Show reset password modal
    showResetPasswordModal() {
        this.modalManager.show('resetPassword');
    }

    // Hide reset password modal
    hideResetPasswordModal() {
        this.modalManager.hide('resetPassword');
    }

    // Send password reset email
    async sendPasswordReset() {
        const email = this.resetEmail.value.trim();
        if (!email) return;

        const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/`
        });

        if (error) {
            alert(this.t('resetEmailError'));
        } else {
            alert(this.t('resetEmailSent'));
            this.hideResetPasswordModal();
        }
    }

    // Show update password modal
    showUpdatePasswordModal() {
        this.modalManager.show('updatePassword');
    }

    // Hide update password modal
    hideUpdatePasswordModal() {
        this.modalManager.hide('updatePassword');
    }

    // Update password
    async updatePassword() {
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmNewPassword').value;

        if (!newPassword || !confirmPassword) return;
        if (newPassword !== confirmPassword) {
            alert(this.t('passwordsDoNotMatch'));
            return;
        }

        const { error } = await this.supabase.auth.updateUser({ password: newPassword });

        if (error) {
            alert(this.t('passwordUpdateError'));
        } else {
            alert(this.t('passwordUpdated'));
            this.hideUpdatePasswordModal();
        this.hideChangeUsernameModal();
            window.location.hash = '';
        }
    }

    // Show change username modal
    showChangeUsernameModal() {
        this.modalManager.show('changeUsername');
    }

    // Hide change username modal
    hideChangeUsernameModal() {
        this.modalManager.hide('changeUsername');
    }

    // Show how it works modal
    showHowItWorksModal() {
        this.modalManager.show('howItWorks');
    }

    // Hide how it works modal
    hideHowItWorksModal() {
        this.modalManager.hide('howItWorks');
    }

    // Show people modal
    async showPeopleModal() {
        // Try to fetch users from a dedicated users table first (sorted by registration date desc)
        let users = [];
        try {
            const { data, error } = await this.supabase
                .from('users')
                .select('id, email, username, created_at')
                .not('username', 'is', null)
                .neq('email', 'info@kaydansky.ru')
                .order('created_at', { ascending: false });

            if (!error && data && data.length > 0) {
                users = data.map(u => ({
                    username: u?.username || u.email || 'Unknown',
                    created_at: u.created_at
                }));
            }
        } catch (err) {
            // ignore and fallback
        }

        // Fallback: derive users from diary_entries if `users` table isn't available
        if (!users || users.length === 0) {
            try {
                const { data: entries } = await this.supabase
                    .from('diary_entries')
                    .select('user_id, username, created_at')
                    .not('username', 'is', null);

                const map = new Map();
                if (entries && entries.length) {
                    entries.forEach(e => {
                        const key = e.user_id || e.username || Date.now().toString();
                        const seen = map.get(key);
                        const created = e.created_at ? new Date(e.created_at) : null;
                        if (!seen) {
                            map.set(key, { username: e.username || 'Unknown', created_at: e.created_at });
                        } else if (created && new Date(seen.created_at) > created) {
                            // keep earliest seen date as registration proxy
                            map.set(key, { username: e.username || 'Unknown', created_at: e.created_at });
                        }
                    });
                }

                users = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            } catch (err) {
                console.error('Failed to load users for people modal:', err);
            }
        }

        // Render to people list in the modal as plain list items with shortened date
        const peopleList = document.getElementById('peopleList');
        if (peopleList) {
            peopleList.innerHTML = '';
            const dateOpts = { year: 'numeric', month: 'short', day: 'numeric' };
            users.forEach(u => {
                const li = document.createElement('li');
                const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString('ru-Ru', dateOpts) : '';
                li.textContent = dateStr ? `${u.username} — ${dateStr}` : u.username;
                peopleList.appendChild(li);
            });
        }

        this.modalManager.show('people');
    }

    // Hide people modal
    hidePeopleModal() {
        this.modalManager.hide('people');
    }

    // Share app
    async shareApp() {
        this.hideHeaderMenu();
        if (navigator.share) {
            try {
                await navigator.share({
                    title: this.t('appTitle'),
                    text: this.t('appSubtitle'),
                    url: APP_SHARE_URL
                });
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.log('Share failed:', err);
                }
            }
        } else {
            alert(this.t('shareNotSupported'));
        }
    }

    // Update username
    async updateUsername() {
        const newUsername = document.getElementById('newUsername').value.trim();
        
        if (!newUsername || newUsername.length < 2) {
            alert(this.t('usernameMinLength'));
            return;
        }
        
        if (newUsername.length > 20) {
            alert(this.t('usernameMaxLength'));
            return;
        }
        
        if (!/^[a-zA-Zа-яА-Я0-9 ]+$/.test(newUsername)) {
            alert(this.t('usernameLettersNumbers'));
            return;
        }
        
        if (newUsername === this.user.user_metadata?.username) {
            this.hideChangeUsernameModal();
            return;
        }
        
        try {
            const { data: existingUsers } = await this.supabase
                .from('diary_entries')
                .select('username')
                .ilike('username', newUsername)
                .limit(1);
            
            if (existingUsers && existingUsers.length > 0) {
                alert(this.t('usernameTaken'));
                return;
            }
            
            const { error } = await this.supabase.auth.updateUser({
                data: { username: newUsername }
            });
            
            if (error) throw error;
            
            this.user.user_metadata.username = newUsername;
            this.updateAuthUI();
            alert(this.t('alertUsernameChanged'));
            this.hideChangeUsernameModal();
            
            if (this.selectedDate) {
                this.renderEntries(this.selectedDate);
            }
        } catch (error) {
            console.error('Error updating username:', error);
            alert(this.t('alertUsernameChangeFailed') + error.message);
        }
    }

    // Delete all entries
    async deleteAllEntries() {
        if (!confirm(this.t('deleteAllEntriesConfirm'))) return;
        
        this.hideAccountModal();
        
        const { error } = await this.supabase
            .from('diary_entries')
            .delete()
            .eq('user_id', this.user.id);
        
        if (error) {
            alert(this.t('errorDeletingEntries') + error.message);
            return;
        }
        
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.renderCalendar();
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
        this.showToast(this.t('allEntriesDeleted'));
    }

    // Delete all images
    async deleteAllImages() {
        if (!confirm(this.t('deleteAllImagesConfirm'))) return;
        
        this.hideAccountModal();
        
        await this.deleteAllUserImages();
        
        await this.supabase
            .from('diary_entries')
            .update({ images: [] })
            .eq('user_id', this.user.id);
        
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
        this.showToast(this.t('allImagesDeleted'));
    }

    // Delete account
    async deleteAccountConfirm() {
        if (!confirm(this.t('deleteAccountConfirm'))) return;
        
        this.hideAccountModal();
        
        try {
            const { data: { session } } = await this.supabase.auth.getSession();
            
            await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            await this.supabase.auth.signOut();
            this.showToast(this.t('accountDeleted'));
        } catch (error) {
            // console.error('Failed to delete account:', error);
            this.showToast(this.t('failedToDeleteAccount'));
        }
    }

    // Toggle theme
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        this.themeIcon.className = newTheme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        this.hideHeaderMenu();
    }

    // Clear cache and reload
    async clearCache() {
        this.hideHeaderMenu();
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }
        }
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        window.location.reload();
    }

    // Escape HTML
    escapeHtml(text) {
        if (text === null || text === undefined) return '';

        const div = document.createElement('div');
        div.textContent = text;
        let escaped = div.innerHTML;

        // Convert email addresses to mailto: links
        escaped = escaped.replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<a href="mailto:$1">$1</a>');

        // Convert http/https URLs to anchors
        escaped = escaped.replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

        // Convert www. links (add http:// for href)
        escaped = escaped.replace(/(^|[^:\/\w])(www\.[^\s<]+)/gi, (match, prefix, url) => {
            return prefix + `<a href="http://${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });

        return escaped;
    }

    // Highlight search query in text
    highlightText(text, query) {
        const escaped = this.escapeHtml(text);
        const words = query.trim().split(/\s+/);
        let result = escaped;
        
        words.forEach(word => {
            const regex = new RegExp(`(${word})`, 'gi');
            result = result.replace(regex, '<mark>$1</mark>');
        });
        
        return result;
    }

    // Initialize swipe and wheel navigation for calendar
    initSwipeAndWheelNavigation() {
        let startX = 0;
        let startY = 0;
        
        // Touch events for swipe navigation
        this.calendarDays.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            this.calendarDays.style.transition = 'none';
        }, { passive: true });
        
        this.calendarDays.addEventListener('touchmove', (e) => {
            if (!startX) return;
            
            const currentX = e.touches[0].clientX;
            const diffX = currentX - startX;
            
            // Only move if horizontal movement is dominant
            if (Math.abs(diffX) > 10) {
                const translateX = Math.max(-100, Math.min(100, diffX * 0.3));
                this.calendarDays.style.transform = `translateX(${translateX}px)`;
            }
        }, { passive: true });
        
        this.calendarDays.addEventListener('touchend', (e) => {
            if (!startX || !startY) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const diffX = startX - endX;
            const diffY = startY - endY;
            
            this.calendarDays.style.transition = '';
            this.calendarDays.style.transform = '';
            
            // Only trigger if horizontal swipe is dominant and significant
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                const direction = diffX > 0 ? 1 : -1;
                
                // Prevent swipe to future months
                if (!this.canNavigateToFuture(direction)) return;
                
                this.animatePageTurn(direction);
            }
            
            startX = 0;
            startY = 0;
        }, { passive: true });
        
        // Mouse wheel navigation for desktop
        this.calendarDays.addEventListener('wheel', (e) => {
            e.preventDefault();
            const direction = e.deltaY > 0 ? 1 : -1;
            
            // Prevent wheel navigation to future months
            if (!this.canNavigateToFuture(direction)) return;
            
            this.changeMonth(direction);
        }, { passive: false });
    }

    // Animate page turning effect for mobile swipe
    async animatePageTurn(direction) {
        const outClass = direction > 0 ? 'swipe-out-left' : 'swipe-out-right';
        const inClass = direction > 0 ? 'swipe-in-right' : 'swipe-in-left';
        
        this.calendarDays.classList.add(outClass);
        
        setTimeout(() => {
            this.currentDate.setMonth(this.currentDate.getMonth() + direction);
            this.renderCalendar();
            this.calendarDays.classList.remove(outClass);
            this.calendarDays.classList.add(inClass);
            
            requestAnimationFrame(() => {
                this.calendarDays.classList.remove(inClass);
            });
            
            this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth()).then(() => {
                this.renderCalendar();
            });
        }, 150);
    }

    // Initialize entry swipe navigation
    initEntrySwipeNavigation() {
        let startX = 0;
        let startY = 0;
        
        this.entryList.addEventListener('touchstart', (e) => {
            if (e.target.closest('.image-thumbnail') || e.target.closest('.menu-btn')) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            this.entryList.style.transition = 'none';
        }, { passive: true });
        
        this.entryList.addEventListener('touchmove', (e) => {
            if (!startX || e.target.closest('.image-thumbnail') || e.target.closest('.menu-btn')) return;
            
            const currentX = e.touches[0].clientX;
            const diffX = currentX - startX;
            
            if (Math.abs(diffX) > 10) {
                const translateX = Math.max(-100, Math.min(100, diffX * 0.3));
                this.entryList.style.transform = `translateX(${translateX}px)`;
            }
        }, { passive: true });
        
        this.entryList.addEventListener('touchend', (e) => {
            if (!startX || !startY || e.target.closest('.image-thumbnail') || e.target.closest('.menu-btn')) return;
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const diffX = startX - endX;
            const diffY = startY - endY;
            
            this.entryList.style.transition = '';
            this.entryList.style.transform = '';
            
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                const direction = diffX > 0 ? 1 : -1;
                this.navigateEntry(direction);
            }
            
            startX = 0;
            startY = 0;
        }, { passive: true });
    }

    // Get all dates with entries from database
    async getAllEntryDates() {
        // Get dates from diary entries
        const { data: entryData } = await this.supabase
            .from('diary_entries')
            .select('date')
            .order('date', { ascending: true });
        
        // Get dates from polls
        const { data: pollData } = await this.supabase
            .from('polls')
            .select('date')
            .order('date', { ascending: true });
        
        // Combine dates from both sources
        const allDates = [];
        
        if (entryData && entryData.length > 0) {
            allDates.push(...entryData.map(entry => entry.date));
        }
        
        if (pollData && pollData.length > 0) {
            allDates.push(...pollData.map(poll => poll.date));
        }
        
        // Remove duplicates and sort
        return [...new Set(allDates)].sort();
    }

    // Navigate to previous/next entry
    async navigateEntry(direction) {
        const allDates = await this.getAllEntryDates();
        
        if (allDates.length === 0) return;
        
        // Check if allDates is empty/null/undefined
        if (!allDates || allDates.length === 0) return;
        
        // Find the first and last dates
        const firstDate = allDates[0];
        const lastDate = allDates[allDates.length - 1];
        
        // Check if we can navigate in the requested direction
        if (direction < 0 && this.selectedDate <= firstDate) return; // Can't go before first date
        if (direction > 0 && this.selectedDate >= lastDate) return; // Can't go after last date
        
        // Find the current date index in the sorted array
        let currentIndex = allDates.indexOf(this.selectedDate);
        
        // If the current date isn't in the array, find the closest date
        if (currentIndex === -1) {
            // Find the first date that is greater than the selected date
            currentIndex = allDates.findIndex(date => date > this.selectedDate);
            
            // If we're going backwards and didn't find a date, use the last date
            if (direction < 0 && currentIndex === -1) {
                currentIndex = allDates.length;
            }
            
            // Adjust the index for backwards navigation
            if (direction < 0) {
                currentIndex = currentIndex === -1 ? allDates.length - 1 : currentIndex - 1;
            }
        } else {
            // Normal navigation
            currentIndex += direction;
        }
        
        // Check bounds
        if (currentIndex < 0 || currentIndex >= allDates.length) return;
        
        const newDate = allDates[currentIndex];
        const [year, month] = newDate.split('-').map(Number);
        
        // Previous entry (direction < 0): current out right, new in from left
        // Next entry (direction > 0): current out left, new in from right
        const outClass = direction < 0 ? 'swipe-out-right' : 'swipe-out-left';
        const inClass = direction < 0 ? 'swipe-in-left' : 'swipe-in-right';
        
        this.entryList.classList.add(outClass);
        
        setTimeout(async () => {
            if (year !== this.currentDate.getFullYear() || month - 1 !== this.currentDate.getMonth()) {
                this.currentDate = new Date(year, month - 1, 1);
                await this.loadEntriesForMonth(year, month - 1);
                this.renderCalendar();
            }
            
            this.selectedDate = newDate;
            this.selectedDateTitle.textContent = this.formatDate(newDate);
            this.updateDateSelects();
            this.renderCalendar();
            
            this.entryList.classList.remove(outClass);
            this.entryList.classList.add(inClass);
            this.renderEntries(newDate);
            
            requestAnimationFrame(() => {
                this.entryList.classList.remove(inClass);
            });
            
            // Update navigation button states
            this.updateEntryNavigation();
        }, 100);
    }

    // Update entry navigation buttons state
    async updateEntryNavigation() {
        const allDates = await this.getAllEntryDates();
        
        if (allDates.length === 0) {
            this.entryNavigation.classList.add('hidden');
            return;
        }
        
        if (allDates.length <= 1) {
            this.entryNavigation.classList.add('hidden');
            return;
        }
        
        this.entryNavigation.classList.remove('hidden');
        
        // Check if allDates is empty/null/undefined
        if (!allDates || allDates.length === 0) {
            this.prevEntryBtn.disabled = true;
            this.nextEntryBtn.disabled = true;
            return;
        }
        
        // Find the first and last dates
        const firstDate = allDates[0];
        const lastDate = allDates[allDates.length - 1];
        
        // Compare this.selectedDate with first and last dates
        this.prevEntryBtn.disabled = this.selectedDate <= firstDate;
        this.nextEntryBtn.disabled = this.selectedDate >= lastDate;
    }

    // Check if running as standalone PWA (iOS)
    isRunningAsStandalone() {
        // iOS Safari
        if ('standalone' in navigator) {
            return navigator.standalone === true;
        }
        // Android Chrome
        if (window.matchMedia('(display-mode: standalone)').matches) {
            return true;
        }
        return false;
    }

    // Apply appropriate body class based on display mode
    applyDisplayModeStyles() {
        if (this.isRunningAsStandalone() || 
            window.innerWidth <= 768 || 
            'ontouchstart' in window) {
            document.body.classList.add('mobile-view');
        } else {
            document.body.classList.add('desktop-view');
        }
    }

    showAiPromptForm() {
        this.aiForm.classList.remove('hidden');
        this.aiTextarea.focus();
        this.entryForm.classList.add('hidden');
        this.pollForm.classList.add('hidden');
    }

    async generateAiPrompt() {
        const prompt = this.aiTextarea.value.trim();
        const wordsLength = this.lengthSelect.value;
        if (!prompt) return;

        try {
            // Fetch all AI users (ai_user = true)
            const { data: aiUsers, error } = await this.supabase
                .from('users')
                .select('*')
                .eq('ai_user', true);
        
            if (error) throw error;
            if (!aiUsers || aiUsers.length === 0) {
                alert('No AI users available');
                return;
            }

            // Randomly select one AI user
            const randomIndex = Math.floor(Math.random() * aiUsers.length);
            const selectedUser = aiUsers[randomIndex];

            console.log('Selected AI user:', selectedUser);
            this.showToast(`AI prompt generated for user: ${selectedUser.username || selectedUser.email}`);

            const payload = {
                userId: selectedUser.id,
                username: selectedUser?.username || null,
                date: this.selectedDate, // 'YYYY-MM-DD'
                gender: selectedUser.male ? 'male' : 'female',
                prompt: prompt,
                outputLength: wordsLength
            };

            const response = await fetch('/api/ai-insert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                console.error('AI insert error', err);
                alert(this.t('errorSavingEntry'));
                return;
            }

            const { entry } = await response.json();

            if (!this.entries[this.selectedDate]) {
                this.entries[this.selectedDate] = [];
            }

            this.entries[this.selectedDate].push({
                id: entry.id,
                user_id: entry.user_id,
                username: entry.username,
                text: entry.text,
                images: entry.images || [],
                createdAt: entry.createdat,
                updatedAt: entry.updatedat,
                type: 'entry',
                originalText: entry.text,
                originalImages: entry.images || []
            });

            this.showEntries(this.selectedDate);
            this.hideAiForm();
        } catch (error) {
            console.error('Error fetching AI users:', error);
            this.showToast('Failed to generate AI prompt');
        }
    }
}

// Initialize app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DiaryApp());
} else {
    new DiaryApp();
}