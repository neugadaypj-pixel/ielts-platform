// Writing Test Auto-Save Utility
(function() {
    if (typeof window === 'undefined') return;
    
    const AUTOSAVE_KEY = 'writing_test_autosave_';
    const AUTOSAVE_INTERVAL = 30000; // 30 seconds
    
    window.WritingAutoSave = {
        init: function(testId) {
            const key = AUTOSAVE_KEY + testId;
            const task1 = document.getElementById('task1');
            const task2 = document.getElementById('task2');
            
            if (!task1 || !task2) return;
            
            // Load saved data
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const data = JSON.parse(saved);
                    if (confirm('Found saved work from ' + new Date(data.timestamp).toLocaleString() + '. Restore it?')) {
                        task1.value = data.task1 || '';
                        task2.value = data.task2 || '';
                    }
                } catch (e) {}
            }
            
            // Auto-save
            setInterval(() => {
                const data = {
                    task1: task1.value,
                    task2: task2.value,
                    timestamp: Date.now()
                };
                localStorage.setItem(key, JSON.stringify(data));
            }, AUTOSAVE_INTERVAL);
            
            // Clear on submit
            const form = task1.closest('form');
            if (form) {
                form.addEventListener('submit', () => {
                    localStorage.removeItem(key);
                });
            }
        }
    };
})();
