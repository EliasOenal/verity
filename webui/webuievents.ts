import { Cube } from '../src/cube';
import { FieldType, Field } from '../src/fieldProcessing';
import { Buffer } from 'buffer';
import { logger } from '../src/logger'

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
function displayCube(cubekey: Buffer) {
    const cube = window.global.node.cubeStore.getCube(cubekey);
    let cubelist: HTMLElement | null = document.getElementById("cubelist")
    if (!cubelist) return;
    displayCubeStart(cubekey, cube, cubelist as HTMLUListElement);
}

function displayCubeStart(cubekey: Buffer, cube: Cube, cubelist: HTMLUListElement) {
    // First of all, is this an original post or a reply?
    let replyto: Buffer | undefined = undefined;
    cube.getFields().forEach(field => {
        if (field.type == FieldType.RELATES_TO) replyto = field.value;
    });

    if (replyto) {
        // We received a reply.
        // We need to check if we have the original post, and append the reply if we do.

        // Replies can have multiple levels, so let's find all reply lists
        let allists: Array<HTMLUListElement> = Array.from(cubelist.getElementsByTagName('ul')).concat([cubelist]);
        // now check all lists for all posts:
        allists.forEach(anycubelist => {
            let allposts: Array<Element> = Array.from(anycubelist.children);
            allposts.forEach(postsli => {
                let candidatecubekeytext: string | null = postsli.getAttribute("cubekey");
                if (!candidatecubekeytext) return;  // this return basically means continue, because JS is crazy
                let candidatecubekey: Buffer = Buffer.from(candidatecubekeytext, 'hex');
                if (candidatecubekey.equals(replyto as Buffer)) {  // this is the original post!
                    displayCubeReply(cubekey, cube, postsli as HTMLLIElement);
                }    
        })
        });
    } else
    {
        // We received an original post.
        // We need to display it, and then check if we have any replies.
        let mypost: HTMLLIElement = displayCubeInList(cubekey, cube, cubelist as HTMLUListElement);  // display it
        window.global.node.cubeStore.storage.forEach((candidatekey, candidateraw) => {
            let candidatereply: Cube = window.global.node.cubeStore.getCube(candidateraw);
            let relatesto: Array<Field> = candidatereply.getFieldsByType(FieldType.RELATES_TO);
            if (relatesto.length>0) {
                if (relatesto[0].value.equals(cubekey)) {  // [0]: We don't want to support replies to multiple posts. Make up your mind, will you?!
                    // this is a reply to us! display it:
                    displayCubeStart(candidatekey, candidatereply, cubelist);
                }
            }
        });
    }
}

function displayCubeReply(key: Buffer, reply: Cube, original: HTMLLIElement) {
    // Does this post already have a reply list?
    let replylist: HTMLUListElement | null = original.getElementsByTagName("ul").item(0);
    if (!replylist) {  // no? time to create one
        replylist = document.createElement('ul');
        original.appendChild(replylist);
    }
    displayCubeInList(key, reply, replylist);
}

function displayCubeInList(cubekey: Buffer, cube: Cube, cubelist: HTMLUListElement): HTMLLIElement {
    // Create cube entry
    let li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", cubekey.toString('hex'));
    li.setAttribute("timestamp", String(cube.getDate())) // keep raw timestamp for later reference

    // Display cube display header (timestamp, later on we'll also show the user etc)
    let header: HTMLParagraphElement = document.createElement("p");
    const date: Date = new Date(cube.getDate()*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    header.innerHTML += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    li.appendChild(header);

    // Display cube payload
    let payload: HTMLParagraphElement = document.createElement('p');
    cube.getFields().forEach(field => {
        if (field.type == FieldType.PAYLOAD) {
            payload.innerHTML += field.value.toString();
        }
    });
    li.append(payload);

    // Show cube key as tooltip
    li.title = `Cube Key ${hexEncode(cubekey.toString())}`;

    // Display reply input field
    let replyfield: HTMLParagraphElement = document.createElement("p");
    replyfield.innerHTML += `<input id="replyinput-${cubekey.toString('hex')}" type="text" size="60" /> `;
    replyfield.innerHTML += `<button id="replybutton-${cubekey.toString('hex')}" onclick="window.global.node.makeNewCube(document.getElementById('replyinput-${cubekey.toString('hex')}').value, '${cubekey.toString('hex')}');">Reply</button>`;

    li.append(replyfield);

    // Insert sorted by date
    if (cubelist) {
        let appended: boolean = false;
        for (const child of cubelist.children) {
            let timestamp: string | null = child.getAttribute("timestamp");
            if (timestamp) {
                let childdate: number = parseInt(timestamp);
                if (childdate < cube.getDate()) {
                    cubelist.insertBefore(li, child);
                    appended = true;
                    break;
                }
            }
        }
        if (!appended) cubelist.appendChild(li);
    }

    return li;
}

// Display all newly connected peers.
// This will handle networkManager newpeer events.
function displayPeer(peer) {
    let li = document.createElement("li");
    li.innerText = `${peer.stats.ip}:${peer.stats.port} (ID ${peer.stats.peerID})`;
    let peerlist: HTMLElement | null = document.getElementById("peerlist");
    if (peerlist) peerlist.appendChild(li);
}

function main() {
    window.global.node.networkManager.on('newpeer', (peer) => displayPeer(peer)) // list peers
    window.global.node.cubeStore.on('hashAdded', (hash) => displayCube(hash)) // list cubes
}
main();