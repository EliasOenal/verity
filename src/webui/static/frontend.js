function selectDefaultTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
  }
}

function updateIcon() {
  const iconSpan = document.getElementById('theme-icon');
  if (document.documentElement.getAttribute('data-bs-theme') === 'dark') {
    iconSpan.innerHTML = '<i class="bi bi-moon-stars-fill"></i>';
  } else {
    iconSpan.innerHTML = '<i class="bi bi-sun-fill"></i>';
  }
}

function toggleDarkMode() {
  if (document.documentElement.getAttribute('data-bs-theme') === 'dark') {
    document.documentElement.setAttribute('data-bs-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
  }
  updateIcon();
}

function veraRoll() {
  const vera = document.getElementById('veralogo');
  vera.classList.add('vera-roll');
  setTimeout(
    () => {
      vera.classList.remove('vera-roll');
    },
  1000);
}

function frontendMain() {
  selectDefaultTheme();
  updateIcon();
}

frontendMain();