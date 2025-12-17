class DiaryApp {
    constructor() {
        this.supabase = null;
        this.currentDate = new Date();
        this.selectedDate = null;
        this.entries = {};
        this.editingEntryId = null;
        this.originalText = '';
        this.autoSaveEntryId = null;
        this.currentLanguage = this.initLanguage();
        this.user = null;
        this.isAuthMode = true;
        this.searchQuery = '';
        this.isNotificationsEnabled = false;

        this.initElements();
        this.initAuth();
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
        
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
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
        
        this.supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                this.user = session.user;
                this.showUpdatePasswordModal();
            } else if (event === 'SIGNED_IN') {
                this.user = session.user;
                document.getElementById('authContainer').classList.add('hidden');
                document.getElementById('mainContainer').classList.remove('hidden');
                this.updateAuthUI();
            } else if (event === 'SIGNED_OUT') {
                this.user = null;
                this.updateAuthUI();
            }
        });
        
        const { data: { session } } = await this.supabase.auth.getSession();
        this.user = session?.user || null;
        this.showMainApp();
        await this.init();
    }

    // Update auth UI
    async updateAuthUI() {
        const signInBtn = document.getElementById('signInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const accountBtn = document.getElementById('accountBtn');
        const notificationsBtn = document.getElementById('notificationsBtn');
        const addEntryBtn = document.getElementById('addEntryBtn');
        const addImageBtn = document.getElementById('addImageBtn');
        
        if (this.user) {
            if (signInBtn) signInBtn.style.display = 'none';
            if (footerText) footerText.style.display = 'none';
            if (signOutBtn) signOutBtn.style.display = 'block';
            if (accountBtn) accountBtn.style.display = 'block';
            if (notificationsBtn) notificationsBtn.style.display = 'block';
            if (addEntryBtn) addEntryBtn.style.display = 'flex';
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
            if (notificationsBtn) notificationsBtn.style.display = 'none';
            if (addEntryBtn) addEntryBtn.style.display = 'none';
            if (addImageBtn) addImageBtn.style.display = 'none';
        }
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
            const username = usernameInput.value;
            const isLogin = loginTab.classList.contains('active');

            if (!isLogin) {
                const passwordRepeatValue = passwordRepeat.value;
                if (password !== passwordRepeatValue) {
                    this.showAuthError(this.t('passwordsDoNotMatch'));
                    return;
                }
                if (!/^[a-zA-Zа-яА-Я0-9]+$/.test(username)) {
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
        
        // Find most recent entry date
        const { data: recentEntry } = await this.supabase
            .from('diary_entries')
            .select('date')
            .order('date', { ascending: false })
            .limit(1)
            .single();
        
        if (recentEntry) {
            const [year, month] = recentEntry.date.split('-').map(Number);
            this.currentDate = new Date(year, month - 1, 1);
            this.selectedDate = recentEntry.date;
        } else {
            this.selectedDate = this.formatDateKey(new Date());
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
                    setTimeout(() => {
                        const entryEl = document.querySelector(`[data-entry-id="${entryId}"]`);
                        // console.log('Found entry element:', entryEl);
                        if (entryEl) {
                            const entryItem = entryEl.closest('.entry-item');
                            if (entryItem) {
                                entryItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                entryItem.style.backgroundColor = 'var(--hover-color)';
                                setTimeout(() => {
                                    entryItem.style.backgroundColor = '';
                                }, 2000);
                            }
                        }
                    }, 500);
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
                                setTimeout(() => {
                                    const entryEl = document.querySelector(`[data-entry-id="${entryId}"]`);
                                    // console.log('Found entry element:', entryEl);
                                    if (entryEl) {
                                        const entryItem = entryEl.closest('.entry-item');
                                        if (entryItem) {
                                            entryItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            entryItem.style.backgroundColor = 'var(--hover-color)';
                                            setTimeout(() => {
                                                entryItem.style.backgroundColor = '';
                                            }, 2000);
                                        }
                                    }
                                }, 500);
                            }
                        });
                    }
                }
            });
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
        
        if (this.isNotificationsEnabled) {
            await this.unsubscribeFromNotifications();
        } else {
            await this.subscribeToNotifications();
        }
    }

    // Subscribe to notifications
    async subscribeToNotifications() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            alert('Push notifications not supported on this device');
            return;
        }

        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                alert('Notification permission denied');
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
            alert('Failed to enable notifications');
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
            alert('Failed to disable notifications');
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
        if (!this.user) return;

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
        this.shareDayBtn = document.getElementById('shareDayBtn');
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
            if (!this.user) return alert(this.t('signInToAddEntries'));
            this.showEntryForm();
        });
        this.addImageBtn.addEventListener('click', () => {
            if (!this.user) return alert(this.t('signInToAddImages'));
            this.handleImageUpload();
        });
        this.shareDayBtn.addEventListener('click', () => this.shareDay());
        this.imageModalClose.addEventListener('click', () => this.closeImageModal());
        this.fileInput.addEventListener('change', (e) => this.processImageFile(e.target.files[0]));
        this.cameraInput.addEventListener('change', (e) => this.processImageFile(e.target.files[0]));
        document.getElementById('selectImageBtn').addEventListener('click', () => this.fileInput.click());
        document.getElementById('cameraBtn').addEventListener('click', () => this.cameraInput.click());
        document.getElementById('cancelImageBtn').addEventListener('click', () => this.hideMobileOptions());
        document.getElementById('shareImageBtn').addEventListener('click', () => this.shareImage());
        document.getElementById('deleteImageBtn').addEventListener('click', () => this.confirmImageDelete());
        document.getElementById('shareImageModalBtn').addEventListener('click', () => this.shareImage());
        document.getElementById('deleteImageModalBtn').addEventListener('click', () => this.confirmImageDelete());
        document.getElementById('cancelImageActionsBtn').addEventListener('click', () => this.hideImageActionsModal());
        this.saveEntryBtn.addEventListener('click', () => this.doneEntry());
        this.clearEntryBtn.addEventListener('click', () => this.clearEntry());
        this.entryTextarea.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.doneEntry();
            }
        });
        this.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.headerMenuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleHeaderMenu();
        });
        this.toggleThemeBtn.addEventListener('click', () => this.toggleTheme());
        document.getElementById('signInBtn').addEventListener('click', () => this.showSignIn());
        document.getElementById('footerSignInLink').addEventListener('click', () => this.showSignIn());
        document.getElementById('accountBtn').addEventListener('click', () => this.showAccountModal());
        this.signOutBtn.addEventListener('click', () => this.signOut());
        document.getElementById('shareEntryModalBtn').addEventListener('click', () => this.handleEntryAction('share'));
        document.getElementById('copyEntryModalBtn').addEventListener('click', () => this.handleEntryAction('copy'));
        document.getElementById('imageEntryModalBtn').addEventListener('click', () => this.handleEntryAction('image'));
        document.getElementById('editEntryModalBtn').addEventListener('click', () => this.handleEntryAction('edit'));
        document.getElementById('deleteEntryModalBtn').addEventListener('click', () => this.handleEntryAction('delete'));
        document.getElementById('cancelEntryActionsBtn').addEventListener('click', () => this.hideEntryActionsModal());
        document.getElementById('languageBtn').addEventListener('click', () => this.showLanguageModal());
        document.getElementById('cancelLanguageBtn').addEventListener('click', () => this.hideLanguageModal());
        document.querySelectorAll('#languageModal [data-lang]').forEach(btn => {
            btn.addEventListener('click', () => this.changeLanguage(btn.dataset.lang));
        });
        document.getElementById('deleteAllEntriesBtn').addEventListener('click', () => this.deleteAllEntries());
        document.getElementById('deleteAllImagesBtn').addEventListener('click', () => this.deleteAllImages());
        document.getElementById('deleteAccountBtn').addEventListener('click', () => this.deleteAccountConfirm());
        document.getElementById('cancelAccountBtn').addEventListener('click', () => this.hideAccountModal());
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
    }

    // Load entries for specific month from Supabase
    async loadEntriesForMonth(year, month) {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        
        const { data } = await this.supabase
            .from('diary_entries')
            .select('*')
            .gte('date', `${monthKey}-01`)
            .lte('date', `${monthKey}-${String(lastDay).padStart(2, '0')}`)
            .order('date', { ascending: true });

        this.entries = {};
        data?.forEach(entry => {
            if (!this.entries[entry.date]) this.entries[entry.date] = [];
            this.entries[entry.date].push({
                id: entry.id,
                user_id: entry.user_id,
                username: entry.username || null,
                text: entry.text,
                images: entry.images || [],
                createdAt: entry.created_at,
                updatedAt: entry.updated_at
            });
        });
    }

    // Save entries to Supabase
    async saveEntries() {
        for (const [date, entries] of Object.entries(this.entries)) {
            for (const entry of entries) {
                const payload = {
                    user_id: this.user.id,
                    username: this.user.user_metadata?.username || null,
                    date: date,
                    text: entry.text,
                    images: entry.images,
                    updated_at: new Date().toISOString()
                };
                
                if (entry.id && entry.id.includes('-')) {
                    payload.id = entry.id;
                }
                
                const { data } = await this.supabase
                    .from('diary_entries')
                    .upsert(payload)
                    .select();
                
                if (data && data[0] && !entry.id.includes('-')) {
                    entry.id = data[0].id;
                }
            }
        }
    }

    // Handle search input
    async handleSearch(query) {
        if (!query.trim()) {
            this.searchResults.classList.add('hidden');
            return;
        }

        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        
        this.searchTimeout = setTimeout(async () => {
            const { data } = await this.supabase
                .from('diary_entries')
                .select('*')
                .ilike('text', `%${query.trim()}%`)
                .limit(10);

            if (!data || data.length === 0) {
                this.searchResults.innerHTML = '<div class="no-entries">' + this.t('noResults') + '</div>';
                this.searchResults.classList.remove('hidden');
                return;
            }

            this.searchResults.innerHTML = data.map(result => {
                const preview = result.text.substring(0, 100) + (result.text.length > 100 ? '...' : '');
                return `
                    <div class="search-result-item" data-date="${result.date}">
                        <div class="search-result-date">${this.formatDate(result.date)}</div>
                        <div class="search-result-text">${this.escapeHtml(preview)}</div>
                    </div>
                `;
            }).join('');

            this.searchResults.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const date = item.dataset.date;
                    const [year, month, day] = date.split('-').map(Number);
                    this.currentDate = new Date(year, month - 1, day);
                    this.selectedDate = date;
                    this.searchQuery = query;
                    await this.loadEntriesForMonth(year, month - 1);
                    this.showEntries(date);
                    this.searchInput.value = '';
                    this.searchResults.classList.add('hidden');
                });
            });

            this.searchResults.classList.remove('hidden');
        }, 300);
    }

    // Save image to Supabase Storage
    async saveImageToIndexedDB(blob) {
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
    async getImageFromIndexedDB(imageUrl) {
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

    // Navigate to previous or next month
    async changeMonth(direction) {
        if (!this.canNavigateToFuture(direction)) return;
        
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
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
        
        for (let year = 1994; year <= currentYear; year++) {
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

        let html = '';
        const today = new Date();
        const todayStr = this.formatDateKey(today);

        for (let i = firstDay - 1; i >= 0; i--) {
            html += `<div class="day other-month">${daysInPrevMonth - i}</div>`;
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

            html += `<div class="${classes}" data-date="${dateKey}">${day}</div>`;
        }

        const remainingCells = 42 - (firstDay + daysInMonth);
        for (let day = 1; day <= remainingCells; day++) {
            html += `<div class="day other-month">${day}</div>`;
        }

        this.calendarDays.innerHTML = html;

        this.calendarDays.querySelectorAll('.day:not(.other-month):not(.future)').forEach(day => {
            day.addEventListener('click', () => {
                const date = day.dataset.date;
                this.selectedDate = date;
                this.renderCalendar();
                this.showEntries(date);
            });
        });
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
        
        // Sort entries by timestamp ascending (oldest first, newest last)
        entries.sort((a, b) => {
            const timeA = new Date(a.createdAt || 0).getTime();
            const timeB = new Date(b.createdAt || 0).getTime();
            return timeA - timeB;
        });
        
        this.shareDayBtn.style.display = entries.length === 0 ? 'none' : 'flex';
        this.updateEntryNavigation();

        if (entries.length === 0) {
            const message = this.t('noEntries');
            this.entryList.innerHTML = `<li class="no-entries">${message}</li>`;
            return;
        }

        this.entryList.innerHTML = entries.map(entry => {
            const entryText = this.searchQuery ? this.highlightText(entry.text, this.searchQuery) : this.escapeHtml(entry.text);
            const entryTime = entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            return `
                <li class="entry-item">
                    <div class="entry-content">
                        ${entry.username ? `<div class="entry-author">— ${this.escapeHtml(entry.username)} &bull; ${entryTime}</div>` : ''}
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
        }).join('');
        
        this.searchQuery = '';

        this.entryList.querySelectorAll('.menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showEntryActionsModal(btn.dataset.entryId, btn.dataset.date);
            });
        });

        entries.forEach(entry => {
            if (entry.images && entry.images.length > 0) {
                this.loadEntryImages(entry.id, entry.images);
            }
        });
    }

    // Show entry form
    showEntryForm() {
        this.originalText = this.entryTextarea.value;
        this.autoSaveEntryId = null;
        this.entryForm.classList.remove('hidden');
        this.entryTextarea.focus();
    }

    // Hide entry form
    hideEntryForm() {
        this.entryForm.classList.add('hidden');
        this.entryTextarea.value = '';
        this.editingEntryId = null;
        this.originalText = '';
        this.autoSaveEntryId = null;
    }



    // Finish editing entry
    doneEntry() {
        const text = this.entryTextarea.value.trim();
        if (text) {
            this.saveEntry(true);
        } else {
            this.hideEntryForm();
        }
    }

    // Save entry
    async saveEntry(hideForm = true) {
        const text = this.entryTextarea.value.trim();
        if (!text) return;
        if (text.length > 1000) {
            alert(this.t('entryTextMaxLength'));
            return;
        }

        if (!this.entries[this.selectedDate]) {
            this.entries[this.selectedDate] = [];
        }

        if (this.editingEntryId) {
            const entry = this.entries[this.selectedDate].find(e => e.id === this.editingEntryId);
            if (entry) {
                entry.text = text;
                entry.updatedAt = new Date().toISOString();
            }
        } else if (this.autoSaveEntryId) {
            const entry = this.entries[this.selectedDate].find(e => e.id === this.autoSaveEntryId);
            if (entry) {
                entry.text = text;
                entry.updatedAt = new Date().toISOString();
            }
        } else {
            const newEntry = {
                id: Date.now().toString(),
                user_id: this.user.id,
                username: this.user.user_metadata?.username || null,
                text: text,
                createdAt: new Date().toISOString()
            };
            this.entries[this.selectedDate].push(newEntry);
            this.autoSaveEntryId = newEntry.id;
        }

        // Get reference to entry object before saving (so we can access updated ID after)
        const tempId = this.editingEntryId || this.autoSaveEntryId;
        const entryRef = this.entries[this.selectedDate].find(e => e.id === tempId);

        // Show spinner and disable buttons
        this.saveEntryBtn.disabled = true;
        this.clearEntryBtn.disabled = true;
        this.saveEntryBtn.classList.add('spinning');
        
        await this.saveEntries();
        
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        
        // Send push notification with actual database UUID (entryRef.id is now updated)
        if (entryRef && entryRef.id) {
            await this.sendPushNotification('entry', entryRef.id);
        }

        // Restore buttons
        this.saveEntryBtn.classList.remove('spinning');
        this.saveEntryBtn.disabled = false;
        this.clearEntryBtn.disabled = false;

        if (hideForm) {
            this.hideEntryForm();
        }

        // Focus on newly added entry
        setTimeout(() => {
            const entryEl = document.querySelector(`[data-entry-id="${entryRef.id}"]`);
            if (entryEl) {
                const entryItem = entryEl.closest('.entry-item');
                if (entryItem) {
                    entryItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }, 100);
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
                entry.text = this.originalText;
                if (this.originalText.trim() === '') {
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

    // Show entry actions modal
    showEntryActionsModal(entryId, date) {
        const entries = this.entries[date] || [];
        const entry = entries.find(e => e.id === entryId);
        
        // Only show edit/delete for own entries
        const isOwnEntry = this.user && entry && entry.user_id === this.user.id;
        document.getElementById('editEntryModalBtn').style.display = isOwnEntry ? '' : 'none';
        document.getElementById('deleteEntryModalBtn').style.display = isOwnEntry ? '' : 'none';
        document.getElementById('imageEntryModalBtn').style.display = isOwnEntry ? '' : 'none';
        
        this.currentEntryId = entryId;
        this.currentEntryDate = date;
        document.getElementById('entryActionsModal').classList.add('show');
    }

    // Hide entry actions modal
    hideEntryActionsModal() {
        document.getElementById('entryActionsModal').classList.remove('show');
    }

    // Handle entry action
    handleEntryAction(action) {
        this.hideEntryActionsModal();
        
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
        if (entry && entry.images) {
            for (const imageUrl of entry.images) {
                await this.deleteImageFromStorage(imageUrl);
            }
        }

        await this.supabase
            .from('diary_entries')
            .delete()
            .eq('id', id);

        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
    }

    // Share entry
    async shareEntry(entry, dateStr) {
        const readableDate = this.formatDate(dateStr);
        
        if (navigator.share) {
            if ((!entry.text || entry.text.trim() === '') && entry.images && entry.images.length > 0) {
                try {
                    const files = [];
                    for (const imageUrl of entry.images) {
                        const blob = await this.getImageFromIndexedDB(imageUrl);
                        if (blob) {
                            const file = new File([blob], `diary-image.jpg`, { type: 'image/jpeg' });
                            files.push(file);
                        }
                    }
                    if (files.length > 0) {
                        await navigator.share({
                            title: `Diary • ${readableDate}`,
                            files: files
                        });
                        return;
                    }
                } catch (err) {
                    console.log('Image sharing failed', err);
                }
            }
            
            const sharedText = `${readableDate}\n\n${entry.text}`;
            navigator.share({
                title: `Diary • ${readableDate}`,
                text: sharedText
            }).catch(err => console.log("Share cancelled or failed", err));
        } else {
            alert("Share failed — the option is not supported on this device.");
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
        
        this.hideMobileOptions();
        
        if (file.size > 15 * 1024 * 1024) {
            alert(this.t('imageTooLarge'));
            return;
        }
        
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        img.onload = async () => {
            let { width, height } = img;
            const maxSize = 1920;
            
            if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width *= ratio;
                height *= ratio;
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob(async (blob) => {
                const imageUrl = await this.saveImageToIndexedDB(blob);
                await this.attachImageToEntry(imageUrl);
            }, 'image/jpeg', 0.8);
        };
        
        img.src = URL.createObjectURL(file);
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
            
            const newEntry = {
                id: Date.now().toString(),
                text: '',
                images: [imageUrl],
                createdAt: new Date().toISOString()
            };
            this.entries[this.selectedDate].push(newEntry);
            entryRef = newEntry;
        }
        
        await this.saveEntries();
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        
        // Send push notification for image
        if (entryRef && entryRef.id) {
            await this.sendPushNotification('image', entryRef.id);
        }
    }

    // Show image modal
    async showImageModal(imageUrl) {
        this.modalImage.src = imageUrl;
        this.imageModal.classList.add('show');
        this.addModalCloseHandlers();
    }

    // Close image modal
    closeImageModal() {
        this.imageModal.classList.remove('show');
        URL.revokeObjectURL(this.modalImage.src);
        this.removeModalCloseHandlers();
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
            img.src = imageUrl;
            img.onclick = () => this.showImageModal(imageUrl);
            
            this.addImageDeleteHandlers(img, imageUrl, entryId);
            container.appendChild(img);
        }
    }

    // Add image delete handlers
    addImageDeleteHandlers(img, imageUrl, entryId) {
        // Check if user owns this entry
        const entry = this.entries[this.selectedDate]?.find(e => e.id === entryId);
        const isOwnEntry = this.user && entry && entry.user_id === this.user.id;
        
        // Only add delete handlers if user owns the entry
        if (!isOwnEntry) return;
        
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
        
        img.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showImageContextMenu(e, imageUrl, entryId);
        });
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
        
        document.getElementById('imageActionsModal').classList.add('show');
    }

    // Hide image actions modal
    hideImageActionsModal() {
        document.getElementById('imageActionsModal').classList.remove('show');
    }

    // Share image
    async shareImage() {
        if (!this.currentImageUrl) return;
        
        this.hideImageContextMenu();
        this.hideImageActionsModal();
        const blob = await this.getImageFromIndexedDB(this.currentImageUrl);
        
        if (blob && navigator.share) {
            const file = new File([blob], 'diary-image.jpg', { type: 'image/jpeg' });
            try {
                await navigator.share({
                    title: 'Diary Image',
                    files: [file]
                });
            } catch (err) {
                console.log('Share cancelled or failed', err);
            }
        } else {
            alert(this.t('imageSharingNotSupported'));
        }
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
        if (entry && entry.images) {
            entry.images = entry.images.filter(img => img !== imageUrl);
            if (entry.images.length === 0) {
                delete entry.images;
            }
            
            await this.supabase
                .from('diary_entries')
                .update({ 
                    images: entry.images || [],
                    updated_at: new Date().toISOString()
                })
                .eq('id', entryId);
            
            if ((!entry.text || entry.text.trim() === '') && !entry.images) {
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
        document.getElementById('languageModal').classList.add('show');
        this.hideHeaderMenu();
    }

    // Hide language modal
    hideLanguageModal() {
        document.getElementById('languageModal').classList.remove('show');
    }

    // Show account modal
    showAccountModal() {
        document.getElementById('accountModal').classList.add('show');
        this.hideHeaderMenu();
    }

    // Hide account modal
    hideAccountModal() {
        document.getElementById('accountModal').classList.remove('show');
    }

    // Show reset password modal
    showResetPasswordModal() {
        document.getElementById('resetPasswordModal').classList.add('show');
    }

    // Hide reset password modal
    hideResetPasswordModal() {
        document.getElementById('resetPasswordModal').classList.remove('show');
        this.resetEmail.value = '';
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
        document.getElementById('updatePasswordModal').classList.add('show');
    }

    // Hide update password modal
    hideUpdatePasswordModal() {
        document.getElementById('updatePasswordModal').classList.remove('show');
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmNewPassword').value = '';
        document.getElementById('newUsername').value = '';
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
        this.hideAccountModal();
        document.getElementById('newUsername').value = this.user.user_metadata?.username || '';
        document.getElementById('changeUsernameModal').classList.add('show');
        document.getElementById('newUsername').focus();
    }

    // Hide change username modal
    hideChangeUsernameModal() {
        document.getElementById('changeUsernameModal').classList.remove('show');
        document.getElementById('newUsername').value = '';
    }

    // Show how it works modal
    showHowItWorksModal() {
        document.getElementById('howItWorksModal').classList.add('show');
        this.hideHeaderMenu();
    }

    // Hide how it works modal
    hideHowItWorksModal() {
        document.getElementById('howItWorksModal').classList.remove('show');
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
        
        if (!/^[a-zA-Zа-яА-Я0-9]+$/.test(newUsername)) {
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
            alert('Username updated successfully!');
            this.hideChangeUsernameModal();
            
            if (this.selectedDate) {
                this.renderEntries(this.selectedDate);
            }
        } catch (error) {
            console.error('Error updating username:', error);
            alert('Error updating username: ' + error.message);
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
        window.location.reload(true);
    }

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

    // Navigate to previous/next entry
    async navigateEntry(direction) {
        // Get all dates with entries from database
        const { data } = await this.supabase
            .from('diary_entries')
            .select('date')
            .order('date', { ascending: true });
        
        if (!data || data.length === 0) return;
        
        const allDates = [...new Set(data.map(entry => entry.date))].sort();
        const currentIndex = allDates.indexOf(this.selectedDate);
        if (currentIndex === -1) return;
        
        const newIndex = currentIndex + direction;
        if (newIndex < 0 || newIndex >= allDates.length) return;
        
        const newDate = allDates[newIndex];
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
        }, 150);
    }

    // Update entry navigation buttons state
    async updateEntryNavigation() {
        // Get all dates with entries from database
        const { data } = await this.supabase
            .from('diary_entries')
            .select('date')
            .order('date', { ascending: true });
        
        if (!data || data.length === 0) {
            this.entryNavigation.classList.add('hidden');
            return;
        }
        
        const allDates = [...new Set(data.map(entry => entry.date))].sort();
        
        if (allDates.length <= 1) {
            this.entryNavigation.classList.add('hidden');
            return;
        }
        
        this.entryNavigation.classList.remove('hidden');
        
        const currentIndex = allDates.indexOf(this.selectedDate);
        this.prevEntryBtn.disabled = currentIndex <= 0;
        this.nextEntryBtn.disabled = currentIndex >= allDates.length - 1;
    }
}

// Initialize app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new DiaryApp());
} else {
    new DiaryApp();
}