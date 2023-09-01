import { Cube } from '../model/cube';
import { CubeInfo } from '../model/cubeInfo';
import * as fp from '../model/fieldProcessing';
import { logger } from '../model/logger'
import { NetworkPeer } from '../model/networkPeer'
import { Buffer } from 'buffer';

// TODO remove -- stolen from https://codepen.io/ovens/pen/EeprWN
// (in contrast to ChatGPT, it appears I can be held accountable for stealing stuff)
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

function redisplayCubes() {
    for (const cubeInfo of window.global.node.cubeStore.getAllCubeInfo()) {
        if (window.global.node.annotationEngine.isCubeDisplayable(cubeInfo.key)) {
            displayCube(cubeInfo.key);
        }
    }
}

// Show all new cubes that are displayable.
// This will handle cubeStore cubeDisplayable events.
function displayCube(key: Buffer) {
    const cubeInfo: CubeInfo = window.global.node.cubeStore.getCubeInfo(key);
    if (!cubeInfo.isComplete()) return;
    const cube: Cube = cubeInfo.instantiate() as Cube;

    // is this a reply?
    const replies: Array<fp.Relationship> = cube.getFields().getRelationships(fp.RelationshipType.REPLY_TO);
    if (replies.length > 0) {  // yes
      const originalpostkey: Buffer = replies[0].remoteKey;
      const originalpost: CubeInfo = window.global.node.cubeStore.getCubeInfo(
        originalpostkey);
      let originalpostli: HTMLLIElement = originalpost.applicationNotes.get('li');
      if (!originalpostli) {  // apparently the original post has not yet been displayed
        displayCube(originalpostkey);
        originalpostli = originalpost.applicationNotes.get('li');
      }
      displayCubeReply(key, cubeInfo, cube, originalpostli);
    }
    else {  // no, this is an original post
    const cubelist: HTMLElement | null = document.getElementById("cubelist")
    if (!cubelist) return;  // who deleted my cube list?!?!?!?!
    displayCubeInList(key, cubeInfo, cube, cubelist as HTMLUListElement);
    }
}


function displayCubeReply(key: Buffer, replyInfo: CubeInfo, reply: Cube, original: HTMLLIElement) {
    // Does this post already have a reply list?
    let replylist: HTMLUListElement | null = original.getElementsByTagName("ul").item(0);
    if (!replylist) {  // no? time to create one
        replylist = document.createElement('ul');
        original.appendChild(replylist);
    }
    displayCubeInList(key, replyInfo, reply, replylist);
}

function displayCubeInList(binaryKey: Buffer, cubeInfo: CubeInfo, cube: Cube, cubelist: HTMLUListElement): HTMLLIElement {
    const keystring = binaryKey.toString('hex');
    // Create cube entry
    let li: HTMLLIElement = document.createElement("li");
    li.setAttribute("cubekey", keystring);  // do we still need this?
    li.setAttribute("timestamp", String(cube.getDate())) // keep raw timestamp for later reference

    // Display cube display header (timestamp, later on we'll also show the user etc)
    let header: HTMLParagraphElement = document.createElement("p");
    const date: Date = new Date(cube.getDate()*1000);
    const dateformat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    header.innerHTML += `<small>${date.toLocaleDateString(navigator.language, dateformat)} ${date.toLocaleTimeString(navigator.language)}</small><br />`
    li.appendChild(header);

    // Display cube payload
    let payload: HTMLParagraphElement = document.createElement('p');
    for (const field of cube.getFields().getFieldsByType(fp.FieldType.PAYLOAD)) {
        payload.innerText += field.value.toString();
    }
    li.append(payload);

    // Show cube key as tooltip
    li.title = `Cube Key ${keystring}`;

    // Display reply input field
    let replyfield: HTMLParagraphElement = document.createElement("p");
    replyfield.innerHTML += `<input id="replyinput-${keystring}" type="text" size="60" /> `;
    replyfield.innerHTML += `<button id="replybutton-${keystring}" onclick="window.global.node.makeNewCube(document.getElementById('replyinput-${keystring}').value, '${keystring}');">Reply</button>`;

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
    // save this post's li as application note in the cube store
    // so we can later append replies to it
    cubeInfo.applicationNotes.set('li', li);
    return li;
}

// Display all peers.
// This will handle all networkManager newpeer events and redraws the peer list
function redisplayPeers() {
    let peerlist: HTMLElement | null = document.getElementById("peerlist");
    if (!peerlist) return;
    peerlist.textContent = '';  // remove all children
    for (let i=0; i<window.global.node.networkManager.outgoingPeers.length; i++) {
        peerlist.appendChild(drawSinglePeer(window.global.node.networkManager.outgoingPeers[i], true));
    }
    for (let i=0; i<window.global.node.networkManager.incomingPeers.length; i++) {
        peerlist.appendChild(drawSinglePeer(window.global.node.networkManager.incomingPeers[i], false));
    }
}

function drawSinglePeer(peer: NetworkPeer, outgoing: boolean): HTMLLIElement {
    let li = document.createElement("li");
    if (outgoing) li.innerText += '(out) '
    else li.innerText += '(in) '
    li.innerText += `${peer.stats.ip}:${peer.stats.port} (ID ${peer.stats.peerID?.toString('hex')})`;
    return li;
}

function webmain() {
    logger.trace("in web main");

    redisplayPeers();
    window.global.node.networkManager.on('newpeer', (peer) => redisplayPeers()) // list peers
    window.global.node.networkManager.on('peerclosed', (peer) => redisplayPeers()) // list peers
    window.global.node.networkManager.on('updatepeer', (peer) => redisplayPeers()) // list peers
    window.global.node.networkManager.on('blacklist', (peer) => redisplayPeers()) // list peers
    window.global.node.networkManager.on('online', (peer) => redisplayPeers()) // list peers
    window.global.node.networkManager.on('shutdown', (peer) => redisplayPeers()) // list peers

    redisplayCubes();
    window.global.node.annotationEngine.on('cubeDisplayable', (binaryKey) => displayCube(binaryKey)) // list cubes
}
// @ts-ignore
window.webmain = webmain;
