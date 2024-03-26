// Note: This is not really a controller... it doesn't even inherit from
// VerityController. It's just a quick'n'dirty hack to manage the startup
// animation. Maybe we'll rework it into a real controller some day...
export class VeraAnimationController {
  private currentTimer: NodeJS.Timeout = undefined;  // it's actually not a NodeJS.Timeout in the browser environment, but we're developing on NodeJS so that's fine
  private veraNest: HTMLElement;
  private veraImg: HTMLImageElement;

  /**
   * Initiate startup animation:
   * Shows Vera centered on the screen doing some light animation
   */
  start(): void {
    this.veraNest = document.getElementById("veraNest") as HTMLImageElement;
    this.veraImg = document.getElementById("veralogo") as HTMLImageElement;
    const natRect: DOMRect = this.veraNest.getBoundingClientRect();
    // move vera to centera of screen
    this.veraNest.setAttribute("style", `transform: translate(${
        window.visualViewport.width/2 - natRect.x - natRect.width/2
      }px, ${
        window.visualViewport.height/2 - natRect.y - natRect.height
      }px);`);
    this.veraNest.classList.replace("hidden", "fade-in");  // fade vera in

    // start Vera animation after one second
    this.currentTimer = setTimeout(() => this.animRadiate(), 1000);
  }

  animRadiate(): void {
    // if Vera is doing something else, make her stop
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraImg.classList.remove("veraAnimRunning");

    // make vera radiate
    this.veraNest.classList.add("pulsateBlue");
    // make vera move up and down
    this.veraImg.classList.add("veraAnimRunning");

    // after three pulses, switch to roll
    this.currentTimer = setTimeout(() => this.animRoll(), 6000);
  }

  animRoll(): void {
    // if Vera is doing something else, make her stop
    this.veraNest.classList.remove('fade-in');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");

    // make her roll
    this.veraImg.classList.add('vera-roll');

    // after one roll, make her pulse again
    this.currentTimer = setTimeout(() => this.animRadiate(), 1000);
  }

  /**
   * Terminate startup animation:
   * Move Vera back into her nest
   */
  stop(): void {
    // stop timer
    clearInterval(this.currentTimer);
    // clear all animations
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");
    // smoothly move Vera back into her spot
    this.veraNest.classList.add("moving");
    this.veraNest.removeAttribute("style");
    // cleanup after move back animation done
    this.currentTimer = setTimeout(() => this.cleanup(), 1000);
  }

  cleanup(): void {
    clearInterval(this.currentTimer);
    this.veraNest.classList.remove('fade-in');
    this.veraImg.classList.remove('vera-roll');
    this.veraNest.classList.remove("pulsateBlue");
    this.veraImg.classList.remove("veraAnimRunning");
    this.veraNest.classList.remove("moving");
    this.veraNest.removeAttribute("style");
  }
}
