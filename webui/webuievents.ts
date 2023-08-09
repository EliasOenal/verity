import { Cube } from '../src/cube';
import { FieldType, Field } from '../src/fieldProcessing';

// Stolen from https://stackoverflow.com/questions/21647928/javascript-unicode-string-to-hex
// (in contrast to ChatGPT, it appears I can be held accountable for stealing stuff)
function hexEncode(msg: string) {
    var hex, i;
    var result = "";
    for (i = 0; i < msg.length; i++) {
      hex = msg.charCodeAt(i).toString(16);
      result += ("000" + hex).slice(-4);
    }
    return result;
  };

// stolen from https://codepen.io/ovens/pen/EeprWN
function genereateRandomSentence() {
    var verbs, nouns, adjectives, adverbs, preposition;
    nouns = ["bird", "clock", "boy", "plastic", "duck", "teacher", "old lady", "professor", "hamster", "dog"];
    verbs = ["kicked", "ran", "flew", "dodged", "sliced", "rolled", "died", "breathed", "slept", "killed"];
    adjectives = ["beautiful", "lazy", "professional", "lovely", "dumb", "rough", "soft", "hot", "vibrating", "slimy"];
    adverbs = ["slowly", "elegantly", "precisely", "quickly", "sadly", "humbly", "proudly", "shockingly", "calmly", "passionately"];
    preposition = ["down", "into", "up", "on", "upon", "below", "above", "through", "across", "towards"];

    function randGen() {
        return Math.floor(Math.random() * 5);
    }

    function sentence() {
        var rand1 = Math.floor(Math.random() * 10);
        var rand2 = Math.floor(Math.random() * 10);
        var rand3 = Math.floor(Math.random() * 10);
        var rand4 = Math.floor(Math.random() * 10);
        var rand5 = Math.floor(Math.random() * 10);
        var rand6 = Math.floor(Math.random() * 10);
        var content = "The " + adjectives[rand1] + " " + nouns[rand2] + " " + adverbs[rand3] + " " + verbs[rand4] + " because some " + nouns[rand1] + " " + adverbs[rand1] + " " + verbs[rand1] + " " + preposition[rand1] + " a " + adjectives[rand2] + " " + nouns[rand5] + " which became a " + adjectives[rand3] + ", " + adjectives[rand4] + " " + nouns[rand6] + ".";
        return content;
    };
    return sentence();
}

async function makeRandomCubes() {
    let num = parseInt((document.getElementById("randomcubecount") as HTMLInputElement).value);
    for (let i = 0; i < num; i++) {
        global.node.makeNewCube(genereateRandomSentence());
    }
}
window.global.makeRandomCubes = makeRandomCubes;

// Show all new cubes received.
// This will handle cubeStore hashAdded events.
function displayCube(hash) {
    // Create entry
    let li = document.createElement("li");
    const cube = window.global.node.cubeStore.getCube(hash);
    li.innerHTML = ""
    li.setAttribute("timestamp", String(cube.date)) // keep raw timestamp for later reference
    const date: Date = new Date(cube.date*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    li.innerHTML += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    cube.fields.forEach(field => {
        if (field.type == FieldType.PAYLOAD) {
            li.innerHTML += field.value.toString();
        }
    });
    li.title = `Cube Hash ${hexEncode(cube.hash.toString())}`;

    // Insert sorted by date
    let cubelist = document.getElementById("cubelist")
    let appended: boolean = false;
    for (const child of cubelist.children) {
        let childdate = parseInt(child.getAttribute("timestamp"));
        if (childdate < cube.date) {
            cubelist.insertBefore(li, child);
            appended = true;
            break;
        }
    }
    if (!appended) cubelist.appendChild(li);
}

// Display all newly connected peers.
// This will handle networkManager newpeer events.
function displayPeer(peer) {
    let li = document.createElement("li");
    li.innerText = `${peer.stats.ip}:${peer.stats.port} (ID ${peer.stats.peerID})`;
    document.getElementById("peerlist").appendChild(li);
}

function main() {
    window.global.node.networkManager.on('newpeer', (peer) => displayPeer(peer)) // list peers
    window.global.node.cubeStore.on('hashAdded', (hash) => displayCube(hash)) // list cubes
}
main();