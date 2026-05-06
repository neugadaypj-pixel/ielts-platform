// Test Time Limit Warning System
(function() {
    const TIME_LIMITS = {
        reading: 60, // 60 minutes
        listening: 40, // 40 minutes  
        writing: 60 // 60 minutes
    };
    
    window.showTimeLimitWarning = function(testType) {
        const limit = TIME_LIMITS[testType];
        if (!limit) return;
        
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:white;border-radius:24px;padding:32px;max-width:500px;width:90%;box-shadow:0 24px 48px rgba(15,23,42,0.18);text-align:center;">
                <div style="font-size:3rem;margin-bottom:16px;">⏱️</div>
                <h2 style="font-size:1.5rem;font-weight:900;margin-bottom:12px;color:#1f2937;">Time Limit: ${limit} Minutes</h2>
                <p style="color:#64748b;line-height:1.6;margin-bottom:24px;">
                    This is an official IELTS ${testType} test with a ${limit}-minute time limit. 
                    Your progress will be automatically saved. You can pause and resume anytime.
                </p>
                <button onclick="this.closest('div').parentElement.remove()" style="padding:14px 32px;border-radius:999px;border:none;background:linear-gradient(135deg,#667eea,#764ba2);color:white;font-weight:800;cursor:pointer;font-size:1rem;">
                    Start Test
                </button>
            </div>
        `;
        document.body.appendChild(overlay);
    };
})();
