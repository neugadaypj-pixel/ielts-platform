// Unified Dark Mode System
(function() {
    const DARK_MODE_KEY = 'platform_dark_mode';
    
    // Apply dark mode immediately to prevent flash
    function applyDarkMode() {
        if (localStorage.getItem(DARK_MODE_KEY) === '1') {
            document.documentElement.classList.add('dark-mode');
            if (document.body) {
                document.body.classList.add('dark-mode');
            }
        }
    }
    
    // Apply before page renders
    applyDarkMode();
    
    // Apply again when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyDarkMode);
    }
    
    // Global toggle function
    window.toggleDarkMode = function() {
        const isDark = document.body.classList.toggle('dark-mode');
        document.documentElement.classList.toggle('dark-mode', isDark);
        localStorage.setItem(DARK_MODE_KEY, isDark ? '1' : '0');
        
        // Update toggle button if it exists
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) {
            toggle.classList.toggle('active', isDark);
        }
        
        // Update theme toggle icon if it exists
        const themeToggle = document.querySelector('.theme-toggle');
        if (themeToggle) {
            themeToggle.textContent = isDark ? '☀️' : '🌙';
        }
        
        return isDark;
    };
    
    // Check if dark mode is enabled
    window.isDarkMode = function() {
        return localStorage.getItem(DARK_MODE_KEY) === '1';
    };
})();
