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
    tx[i].addEventListener("input", onTextareaInput, false);
  }
}
function onTextareaInput() {
  // auto-resize
  this.style.height = 0;
  this.style.height = (this.scrollHeight) + "px";

  // handle progress bar
  const containingDiv = this.parentElement.parentElement;
  const progressContainer =
    containingDiv.getElementsByClassName("verityPostCharCountBarContainer")[0];
  const progressBar =
    containingDiv.getElementsByClassName("verityPostCharCountBar")[0];
  const remainingCharDisplay =
    containingDiv.getElementsByClassName("verityPostRemainingChars")[0];
  // max length is in byte, not utf8 chars
  const byteSize = str => new Blob([str]).size;
  if (this.value.length > 0) {
    progressContainer.setAttribute("style", "display: flex;")
    const charsLeft = this.getAttribute("maxlength") - byteSize(this.value);
    remainingCharDisplay.innerText = charsLeft;
    const percentageLeft =
      (1 - byteSize(this.value) / this.getAttribute("maxlength")) * 100;
    progressBar.setAttribute("style", `width: ${percentageLeft}%`)
    if (charsLeft < this.getAttribute("maxlength") / 3) {
      remainingCharDisplay.setAttribute("style", "display: flex");
    } else {
      remainingCharDisplay.setAttribute("style", "display: none");
    }
  } else {
    progressContainer.setAttribute("style", "display: none;")
  }
}
window.onTextareaInput = onTextareaInput;

function frontendMain() {
  updateIcon();
  autoResizeTextareas();
}

frontendMain();