// function previously used to spam random anonymous content for testing
async function makeRandomCubes() {
  const num = parseInt((document.getElementById("randomcubecount") as HTMLInputElement).value);
  for (let i = 0; i < num; i++) {
      global.node.makeNewCube(genereateRandomSentence());
  }
}
window.global.makeRandomCubes = makeRandomCubes;

// TODO remove -- stolen from https://codepen.io/ovens/pen/EeprWN
// (in contrast to ChatGPT, it appears I can be held accountable for stealing stuff)
function genereateRandomSentence() {
  let verbs, nouns, adjectives, adverbs, preposition;
  nouns = ["bird", "clock", "boy", "plastic", "duck", "teacher", "old lady", "professor", "hamster", "dog"];
  verbs = ["kicked", "ran", "flew", "dodged", "sliced", "rolled", "died", "breathed", "slept", "killed"];
  adjectives = ["beautiful", "lazy", "professional", "lovely", "dumb", "rough", "soft", "hot", "vibrating", "slimy"];
  adverbs = ["slowly", "elegantly", "precisely", "quickly", "sadly", "humbly", "proudly", "shockingly", "calmly", "passionately"];
  preposition = ["down", "into", "up", "on", "upon", "below", "above", "through", "across", "towards"];

  function randGen() {
      return Math.floor(Math.random() * 5);
  }

  function sentence() {
      const rand1 = Math.floor(Math.random() * 10);
      const rand2 = Math.floor(Math.random() * 10);
      const rand3 = Math.floor(Math.random() * 10);
      const rand4 = Math.floor(Math.random() * 10);
      const rand5 = Math.floor(Math.random() * 10);
      const rand6 = Math.floor(Math.random() * 10);
      const content = "The " + adjectives[rand1] + " " + nouns[rand2] + " " + adverbs[rand3] + " " + verbs[rand4] + " because some " + nouns[rand1] + " " + adverbs[rand1] + " " + verbs[rand1] + " " + preposition[rand1] + " a " + adjectives[rand2] + " " + nouns[rand5] + " which became a " + adjectives[rand3] + ", " + adjectives[rand4] + " " + nouns[rand6] + ".";
      return content;
  }
  return sentence();
}