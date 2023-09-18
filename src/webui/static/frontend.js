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

// This effectively only handles the new post input for now and the code is
// more or less replicated in PostViews for replies.
// At some point, the new post input needs to be moved to PostView anyway.
function autoResizeTextareas() {
  const tx = document.getElementsByTagName("textarea");
  for (let i = 0; i < tx.length; i++) {
    tx[i].setAttribute("style", "height:" + (tx[i].scrollHeight) + "px;overflow-y:hidden;");
    tx[i].addEventListener("input", OnInput, false);
  }

  function OnInput() {
    this.style.height = 0;
    this.style.height = (this.scrollHeight) + "px";
  }
}

function frontendMain() {
  selectDefaultTheme();
  updateIcon();
  autoResizeTextareas();
}

frontendMain();