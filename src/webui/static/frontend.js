function registerServiceWorker() {
  if ("serviceWorker" in window.navigator) {
    window.addEventListener("load", function() {
      window.navigator.serviceWorker
        .register("/serviceWorker.js")
        .then(res => console.log("Verity service worker registered"))
        .catch(err => console.log("Verity service worker not registered: ", err))
    })
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
  const tx = document.getElementsByClassName("verityPostInput");
  for (let i = 0; i < tx.length; i++) {
    tx[i].setAttribute("style", "height:" + (tx[i].scrollHeight) + "px;overflow-y:hidden;");
  }
}

function onTextareaInput(textarea) {
  // auto-resize
  textarea.style.height = 0;
  textarea.style.height = (textarea.scrollHeight) + "px";

  // handle progress bar
  const containingDiv = textarea.parentElement.parentElement;
  const progressContainer =
    containingDiv.getElementsByClassName("verityPostCharCountBarContainer")[0];
  const progressBar =
    containingDiv.getElementsByClassName("verityPostCharCountBar")[0];
  const remainingCharDisplay =
    containingDiv.getElementsByClassName("verityPostRemainingChars")[0];
  // max length is in byte, not utf8 chars
  const byteSize = str => new Blob([str]).size;
  if (textarea.value.length > 0) {
    progressContainer.setAttribute("style", "display: flex;")
    const charsLeft = textarea.getAttribute("maxlength") - byteSize(textarea.value);
    remainingCharDisplay.textContent = charsLeft;
    const percentageLeft =
      (1 - byteSize(textarea.value) / textarea.getAttribute("maxlength")) * 100;
    progressBar.setAttribute("style", `width: ${percentageLeft}%`)
    if (charsLeft < textarea.getAttribute("maxlength") / 3) {
      remainingCharDisplay.setAttribute("style", "display: flex");
    } else {
      remainingCharDisplay.setAttribute("style", "display: none");
    }
  } else {
    progressContainer.setAttribute("style", "display: none;")
  }
}
window.onTextareaInput = onTextareaInput;

function clearParent(elem, parentLevel = 1, queryString="input") {
  for (let i=0; i<parentLevel; i++) elem = elem.parentElement;
  for (const target of elem.querySelectorAll(queryString)) target.value = "";
}

function togglePostContent(button) {
  const postContent = button.closest('.verityPost').querySelector('.verityPostContent');

  if (postContent.classList.contains('expand')) {
    // Collapse content
    button.classList.remove('rotate');
    postContent.classList.remove('expand');
  } else if (postContent.scrollHeight > postContent.clientHeight){
    // Expand content
    button.classList.add('rotate');
    postContent.classList.add('expand');
  } else {
    // No need to expand, remove button
    button.remove();
  }
}
window.togglePostContent = togglePostContent;

function frontendMain() {
  registerServiceWorker();
  updateIcon();
  autoResizeTextareas();
}

frontendMain();
