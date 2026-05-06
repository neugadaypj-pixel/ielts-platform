// Loading Spinner Utility
(function() {
    const style = document.createElement('style');
    style.textContent = `
        .btn-loading { position: relative; pointer-events: none; opacity: 0.7; }
        .btn-loading::after {
            content: '';
            position: absolute;
            width: 16px;
            height: 16px;
            top: 50%;
            left: 50%;
            margin-left: -8px;
            margin-top: -8px;
            border: 2px solid #fff;
            border-radius: 50%;
            border-top-color: transparent;
            animation: spinner 0.6s linear infinite;
        }
        @keyframes spinner {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    window.addLoadingSpinner = function(btn) {
        if (!btn) return;
        btn.classList.add('btn-loading');
        btn.disabled = true;
    };
    
    window.removeLoadingSpinner = function(btn) {
        if (!btn) return;
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    };
    
    // Auto-add to forms
    document.addEventListener('submit', (e) => {
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) addLoadingSpinner(btn);
    });
})();
