// Loading Spinner Utility — polished multi-step animation
(function() {
    const style = document.createElement('style');
    style.textContent = `
        /* Pulsing dot loader for page-level loading states */
        .page-loader {
            position: fixed;
            inset: 0;
            z-index: 99990;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        body.dark-mode .page-loader {
            background: rgba(15, 23, 42, 0.88);
        }
        .page-loader-dots {
            display: flex;
            gap: 12px;
            align-items: center;
        }
        .page-loader-dots span {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            animation: loaderBounce 0.6s ease-in-out infinite;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.35);
        }
        .page-loader-dots span:nth-child(2) { animation-delay: 0.15s; }
        .page-loader-dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes loaderBounce {
            0%, 100% { transform: translateY(0) scale(1); }
            25% { transform: translateY(-24px) scale(1.15); }
            50% { transform: translateY(0) scale(0.95); }
            75% { transform: translateY(8px) scale(1.05); }
        }
        /* Button loading state — shimmer ring */
        .btn-loading {
            position: relative;
            pointer-events: none;
            opacity: 0.75;
            color: transparent !important;
        }
        .btn-loading::after {
            content: '';
            position: absolute;
            width: 22px;
            height: 22px;
            top: 50%;
            left: 50%;
            margin-left: -11px;
            margin-top: -11px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: btnSpinner 0.7s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
        }
        @keyframes btnSpinner {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(720deg); }
        }
        /* Global page loader helper */
        .global-loading::before {
            content: '';
            position: fixed;
            inset: 0;
            z-index: 99989;
            background: linear-gradient(
                90deg,
                rgba(102, 126, 234, 0.06) 0%,
                rgba(118, 75, 162, 0.08) 50%,
                rgba(102, 126, 234, 0.06) 100%
            );
            background-size: 200% 100%;
            animation: loaderShimmer 1.8s ease-in-out infinite;
            pointer-events: all;
        }
        @keyframes loaderShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
    document.head.appendChild(style);

    // Show a full-page bouncing dots loader
    window.showPageLoader = function() {
        if (document.getElementById('__pageLoader')) return;
        var loader = document.createElement('div');
        loader.id = '__pageLoader';
        loader.className = 'page-loader';
        loader.innerHTML = '<div class="page-loader-dots"><span></span><span></span><span></span></div>';
        document.body.appendChild(loader);
    };

    window.hidePageLoader = function() {
        var loader = document.getElementById('__pageLoader');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { if (loader.parentNode) loader.remove(); }, 300);
        }
    };

    // Button-level loading
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

    // Auto-add to form submissions
    document.addEventListener('submit', function(e) {
        var btn = e.target.querySelector('button[type="submit"]');
        if (btn) addLoadingSpinner(btn);
    });

    // Page load: show loader on navigation clicks
    document.addEventListener('click', function(e) {
        var link = e.target.closest('a');
        if (link && link.href && !link.target && link.origin === window.location.origin) {
            var isSamePage = link.getAttribute('href') === '#' || link.getAttribute('href') === '';
            var isLogout = link.href.includes('/logout');
            if (!isSamePage && !isLogout) {
                showPageLoader();
            }
        }
    });

    // Hide loader when page finishes loading
    window.addEventListener('pageshow', function() { hidePageLoader(); });
    window.addEventListener('load', function() { hidePageLoader(); });
})();
