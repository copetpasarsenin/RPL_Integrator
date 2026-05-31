$baseDir = "c:\Users\achma\Documents\RPL_Integrator-main (1)\RPL_Integrator-main\views"
$files = @("dashboard.ejs", "client_portal.ejs", "login.ejs", "register.ejs", "index.ejs")

$newJsLogic = @"
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) {
                const isDark = localStorage.getItem('darkMode') === 'true';
                if (isDark) document.body.classList.add('dark-mode');
                
                toggle.innerHTML = isDark ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
                if (window.lucide) lucide.createIcons();

                // Hapus event listener lama dengan clone node (jika ada script ganda)
                const newToggle = toggle.cloneNode(true);
                toggle.parentNode.replaceChild(newToggle, toggle);

                newToggle.addEventListener('click', () => {
                    document.body.classList.toggle('dark-mode');
                    const dark = document.body.classList.contains('dark-mode');
                    localStorage.setItem('darkMode', dark);
                    
                    newToggle.innerHTML = dark ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
                    if (window.lucide) lucide.createIcons();
                });
            } else {
                if (localStorage.getItem('darkMode') === 'true') {
                    document.body.classList.add('dark-mode');
                }
            }
"@

foreach ($file in $files) {
    $f = "$baseDir\$file"
    if (Test-Path $f) {
        $c = Get-Content $f -Raw
        
        # Regex to find the block starting with "const toggle = document.getElementById('darkModeToggle');"
        # and ending with "});" (the toggle click listener) or similar.
        # Since the script is multi-line and we injected it earlier, it's better to just replace the known bad blocks.

        # Bad pattern 1 (from my injected patch)
        $badPattern1 = "(?s)const toggle = document\.getElementById\('darkModeToggle'\);\s*if \(toggle\) \{\s*const icon = toggle\.querySelector\('i'\);\s*const isDark = localStorage\.getItem\('darkMode'\) === 'true';.*?else \{\s*if \(localStorage\.getItem\('darkMode'\) === 'true'\) \{\s*document\.body\.classList\.add\('dark-mode'\);\s*\}\s*\}"
        
        # Bad pattern 2 (original dashboard.ejs)
        $badPattern2 = "(?s)const toggle = document\.getElementById\('darkModeToggle'\);\s*if \(toggle\) \{\s*const icon = toggle\.querySelector\('i'\);\s*const isDark = localStorage\.getItem\('darkMode'\) === 'true';.*?lucide\.createIcons\(\);\s*\}\s*\}"

        if ($c -match $badPattern1) {
            $c = $c -replace $badPattern1, $newJsLogic
            Set-Content $f $c -NoNewline
            Write-Host "Fixed logic in $file (Pattern 1)"
        } elseif ($c -match $badPattern2) {
            $c = $c -replace $badPattern2, $newJsLogic
            Set-Content $f $c -NoNewline
            Write-Host "Fixed logic in $file (Pattern 2)"
        } else {
            Write-Host "Could not find bad pattern in $file"
        }
    }
}
