class DiaryApp {
    constructor() {
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
            el.textContent = this.t(el.dataset.i18n);
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
        
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
        this.renderCalendar();
    }

    // Initialize authentication
    async initAuth() {
        if (!supabase) {
            const { createClient } = window.supabase;
            supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
        
        const { data: { session } } = await supabase.auth.getSession();
        this.user = session?.user || null;
        this.showMainApp();
        await this.init();

        supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN') {
                this.user = session.user;
                document.getElementById('authContainer').classList.add('hidden');
                document.getElementById('mainContainer').classList.remove('hidden');
                this.updateAuthUI();
            } else if (event === 'SIGNED_OUT') {
                this.user = null;
                this.updateAuthUI();
            }
        });
    }

    // Update auth UI
    updateAuthUI() {
        const signInBtn = document.getElementById('signInBtn');
        const signOutBtn = document.getElementById('signOutBtn');
        const accountBtn = document.getElementById('accountBtn');
        const addEntryBtn = document.getElementById('addEntryBtn');
        const addImageBtn = document.getElementById('addImageBtn');
        
        if (this.user) {
            signInBtn.style.display = 'none';
            footerText.style.display = 'none';
            signOutBtn.style.display = 'block';
            accountBtn.style.display = 'block';
            addEntryBtn.style.display = 'flex';
            addImageBtn.style.display = 'flex';
        } else {
            signInBtn.style.display = 'block';
            footerText.style.display = 'block';
            signOutBtn.style.display = 'none';
            accountBtn.style.display = 'none';
            addEntryBtn.style.display = 'none';
            addImageBtn.style.display = 'none';
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

        loginTab.addEventListener('click', () => {
            loginTab.classList.add('active');
            signupTab.classList.remove('active');
            authSubmit.textContent = this.t('signIn');
            usernameInput.removeAttribute('required');
            passwordRepeat.removeAttribute('required');
            usernameInput.classList.add('hidden');
            passwordRepeat.classList.add('hidden');
        });

        signupTab.addEventListener('click', () => {
            signupTab.classList.add('active');
            loginTab.classList.remove('active');
            authSubmit.textContent = this.t('signUp');
            usernameInput.classList.remove('hidden');
            usernameInput.setAttribute('required', '');
            passwordRepeat.classList.remove('hidden');
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
                    this.showAuthError('Passwords do not match');
                    return;
                }
                if (!/^[a-zA-Zа-яА-Я0-9]+$/.test(username)) {
                    this.showAuthError('Username must contain only letters and numbers');
                    return;
                }
                if (username.length > 20) {
                    this.showAuthError('Username must be 20 characters or less');
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
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    // Sign up user
    async signUp(email, password, username) {
        const { data: existingUsers } = await supabase
            .from('diary_entries')
            .select('username')
            .ilike('username', username)
            .limit(1);
        
        if (existingUsers && existingUsers.length > 0) {
            throw new Error('Username already taken');
        }
        
        const { data, error } = await supabase.auth.signUp({
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
        this.hideHeaderMenu();
        this.showAuthForm();
    }

    // Sign out user
    async signOut() {
        try {
            await supabase.auth.signOut();
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
        this.showToast('You have been logged out');
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
        
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        this.updateUI();
        
        if (this.user) {
            this.initPushNotifications();
        }
    }

    // Initialize push notifications
    async initPushNotifications() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('Push notifications not supported');
            return;
        }

        try {
            const permission = await Notification.requestPermission();
            console.log('Notification permission:', permission);
            if (permission !== 'granted') {
                console.log('Notification permission denied');
                return;
            }

            const registration = await navigator.serviceWorker.ready;
            console.log('Service worker ready');
            
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
            console.log('Push subscription created:', subscription);

            const { data, error } = await supabase
                .from('push_subscriptions')
                .upsert({
                    user_id: this.user.id,
                    subscription: subscription.toJSON()
                })
                .select();

            if (error) {
                console.error('Failed to save subscription to database:', error);
            } else {
                console.log('Push notification subscription saved to database:', data);
            }
        } catch (error) {
            console.error('Failed to subscribe to push notifications:', error);
        }
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

    // Send push notification to all users
    async sendPushNotification(type) {
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
                    type: type
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
        this.searchInput = document.getElementById('searchInput');
        this.searchResults = document.getElementById('searchResults');
        this.headerMenuToggle = document.getElementById('headerMenuToggle');
        this.headerDropdown = document.getElementById('headerDropdown');
        this.toggleThemeBtn = document.getElementById('toggleThemeBtn');
        this.themeIcon = document.getElementById('themeIcon');
        this.signOutBtn = document.getElementById('signOutBtn');
    }

    // Set up event listeners
    initEventListeners() {
        this.prevMonthBtn.addEventListener('click', () => this.changeMonth(-1));
        this.nextMonthBtn.addEventListener('click', () => {
            if (this.canNavigateToFuture(1)) this.changeMonth(1);
        });
        this.todayBtn.addEventListener('click', () => this.goToToday());
        this.initSwipeAndWheelNavigation();
        this.addEntryBtn.addEventListener('click', () => {
            if (!this.user) return alert('Please sign in to add entries');
            this.showEntryForm();
        });
        this.addImageBtn.addEventListener('click', () => {
            if (!this.user) return alert('Please sign in to add images');
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
        document.getElementById('footerText').addEventListener('click', () => this.showSignIn());
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
        document.addEventListener('click', () => this.hideHeaderMenu());
    }

    // Load entries for specific month from Supabase
    async loadEntriesForMonth(year, month) {
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        const { data } = await supabase
            .from('diary_entries')
            .select('*')
            .gte('date', `${monthKey}-01`)
            .lte('date', `${monthKey}-31`)
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
                
                const { data } = await supabase
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
            // Format query for tsquery: replace spaces with & (AND operator)
            const formattedQuery = query.trim().split(/\s+/).join(' & ');
            
            const { data } = await supabase
                .from('diary_entries')
                .select('*')
                .textSearch('text', formattedQuery)
                .limit(10);

            if (!data || data.length === 0) {
                this.searchResults.innerHTML = '<div class="no-entries">No results found</div>';
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
        
        const { data } = await supabase.storage
            .from('diary-images')
            .upload(fileName, blob);

        const { data: { publicUrl } } = supabase.storage
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
    }

    // Render list of entries
    renderEntries(date) {
        const entries = this.entries[date] || [];
        
        this.shareDayBtn.style.display = entries.length === 0 ? 'none' : 'flex';

        if (entries.length === 0) {
            const message = this.user ? this.t('noEntries') : this.t('noEntriesGuest');
            this.entryList.innerHTML = `<li class="no-entries">${message}</li>`;
            return;
        }

        this.entryList.innerHTML = entries.map(entry => {
            const entryText = this.searchQuery ? this.highlightText(entry.text, this.searchQuery) : this.escapeHtml(entry.text);
            return `
                <li class="entry-item">
                    <div class="entry-content">
                        ${entry.username ? `<div class="entry-author">— ${this.escapeHtml(entry.username)}</div>` : ''}
                        <div class="entry-text">${entryText}</div>
                        <div class="entry-images" id="images-${entry.id}"></div>
                    </div>
                    <div class="entry-actions">
                        <button class="menu-btn" data-entry-id="${entry.id}" data-date="${date}" title="Entry options">
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
            alert('Entry text must be 1000 characters or less');
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

        await this.saveEntries();
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        
        // Send push notification
        await this.sendPushNotification('entry');
        
        if (hideForm) {
            this.hideEntryForm();
        }
    }

    // Clear entry
    async clearEntry() {
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

        await supabase
            .from('diary_entries')
            .delete()
            .eq('id', id);

        this.entries[this.selectedDate] = this.entries[this.selectedDate].filter(e => e.id !== id);

        if (this.entries[this.selectedDate].length === 0) {
            delete this.entries[this.selectedDate];
        }

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
            alert("No entries to share for this day.");
            return;
        }
        
        const readableDate = this.formatDate(this.selectedDate);
        const separator = "\n" + "─".repeat(10) + "\n";
        const entriesText = entries.map(entry => entry.text).filter(text => text && text.trim()).join(separator);
        
        if (!entriesText.trim()) {
            alert("No text entries to share for this day.");
            return;
        }
        
        const sharedText = `${readableDate}\n\n${entriesText}`;
        
        if (navigator.share) {
            navigator.share({
                title: `Diary • ${readableDate}`,
                text: sharedText
            }).catch(err => console.log("Share cancelled or failed", err));
        } else {
            alert("Share failed — the option is not supported on this device.");
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
            alert('Image file is too large. Please select an image smaller than 15MB.');
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
        if (this.currentEntryId) {
            const entry = this.entries[this.selectedDate].find(e => e.id === this.currentEntryId);
            if (entry) {
                if (!entry.images) entry.images = [];
                entry.images.push(imageUrl);
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
        }
        
        await this.saveEntries();
        this.renderEntries(this.selectedDate);
        this.renderCalendar();
        
        // Send push notification for image
        await this.sendPushNotification('image');
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
            alert('Image sharing not supported on this device.');
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
            await supabase.storage
                .from('diary-images')
                .remove([filePath]);
        }
    }

    // Delete all user images from storage
    async deleteAllUserImages() {
        const { data: files } = await supabase.storage
            .from('diary-images')
            .list(this.user.id);
        
        if (files && files.length > 0) {
            const filePaths = files.map(file => `${this.user.id}/${file.name}`);
            await supabase.storage
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
            
            await supabase
                .from('diary_entries')
                .update({ 
                    images: entry.images || [],
                    updated_at: new Date().toISOString()
                })
                .eq('id', entryId);
            
            if ((!entry.text || entry.text.trim() === '') && !entry.images) {
                await supabase
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

    // Delete all entries
    async deleteAllEntries() {
        if (!confirm(this.t('deleteAllEntriesConfirm'))) return;
        
        this.hideAccountModal();
        
        const { error } = await supabase
            .from('diary_entries')
            .delete()
            .eq('user_id', this.user.id);
        
        if (error) {
            alert('Error deleting entries: ' + error.message);
            return;
        }
        
        this.entries = {};
        this.renderCalendar();
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
        this.showToast('All entries deleted');
    }

    // Delete all images
    async deleteAllImages() {
        if (!confirm(this.t('deleteAllImagesConfirm'))) return;
        
        this.hideAccountModal();
        
        await this.deleteAllUserImages();
        
        await supabase
            .from('diary_entries')
            .update({ images: [] })
            .eq('user_id', this.user.id);
        
        await this.loadEntriesForMonth(this.currentDate.getFullYear(), this.currentDate.getMonth());
        if (this.selectedDate) {
            this.renderEntries(this.selectedDate);
        }
        this.showToast('All images deleted');
    }

    // Delete account
    async deleteAccountConfirm() {
        if (!confirm(this.t('deleteAccountConfirm'))) return;
        
        this.hideAccountModal();
        
        try {
            const { data: { session } } = await supabase.auth.getSession();
            
            await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            this.showToast('Account deleted successfully');
        } catch (error) {
            console.error('Failed to delete account:', error);
            this.showToast('Failed to delete account');
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
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new DiaryApp();
});