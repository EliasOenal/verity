import { cciCube } from "../../../src/cci/cube/cciCube";
import { MediaTypes, cciFieldType } from "../../../src/cci/cube/cciCube.definitions";
import { cciField } from "../../../src/cci/cube/cciField";
import { cciFields } from "../../../src/cci/cube/cciFields";
import { cciRelationship, cciRelationshipType } from "../../../src/cci/cube/cciRelationship";
import { Continuation } from "../../../src/cci/cube/continuation";
import { CubeType } from "../../../src/core/cube/cube.definitions";
import { NetConstants } from "../../../src/core/networking/networkDefinitions";

const tooLong = "Gallia est omnis divisa in partes tres, quarum unam incolunt Belgae, aliam Aquitani, tertiam qui ipsorum lingua Celtae, nostra Galli appellantur. Hi omnes lingua, institutis, legibus inter se differunt. Gallos ab Aquitanis Garumna flumen, a Belgis Matrona et Sequana dividit. Horum omnium fortissimi sunt Belgae, propterea quod a cultu atque humanitate provinciae longissime absunt, minimeque ad eos mercatores saepe commeant atque ea quae ad effeminandos animos pertinent important, proximique sunt Germanis, qui trans Rhenum incolunt, quibuscum continenter bellum gerunt. Qua de causa Helvetii quoque reliquos Gallos virtute praecedunt, quod fere cotidianis proeliis cum Germanis contendunt, cum aut suis finibus eos prohibent aut ipsi in eorum finibus bellum gerunt. Eorum una pars, quam Gallos obtinere dictum est, initium capit a flumine Rhodano, continetur Garumna flumine, Oceano, finibus Belgarum, attingit etiam ab Sequanis et Helvetiis flumen Rhenum, vergit ad septentriones. Belgae ab extremis Galliae finibus oriuntur, pertinent ad inferiorem partem fluminis Rheni, spectant in septentrionem et orientem solem. Aquitania a Garumna flumine ad Pyrenaeos montes et eam partem Oceani quae est ad Hispaniam pertinet; spectat inter occasum solis et septentriones.";
const farTooLong = "Apud Helvetios longe nobilissimus fuit et ditissimus Orgetorix. Is M. Messala, [et P.] M. Pisone consulibus regni cupiditate inductus coniurationem nobilitatis fecit et civitati persuasit ut de finibus suis cum omnibus copiis exirent: perfacile esse, cum virtute omnibus praestarent, totius Galliae imperio potiri. Id hoc facilius iis persuasit, quod undique loci natura Helvetii continentur: una ex parte flumine Rheno latissimo atque altissimo, qui agrum Helvetium a Germanis dividit; altera ex parte monte Iura altissimo, qui est inter Sequanos et Helvetios; tertia lacu Lemanno et flumine Rhodano, qui provinciam nostram ab Helvetiis dividit. His rebus fiebat ut et minus late vagarentur et minus facile finitimis bellum inferre possent; qua ex parte homines bellandi cupidi magno dolore adficiebantur. Pro multitudine autem hominum et pro gloria belli atque fortitudinis angustos se fines habere arbitrabantur, qui in longitudinem milia passuum CCXL, in latitudinem CLXXX patebant. His rebus adducti et auctoritate Orgetorigis permoti constituerunt ea quae ad proficiscendum pertinerent comparare, iumentorum et carrorum quam maximum numerum coemere, sementes quam maximas facere, ut in itinere copia frumenti suppeteret, cum proximis civitatibus pacem et amicitiam confirmare. Ad eas res conficiendas biennium sibi satis esse duxerunt; in tertium annum profectionem lege confirmant. Ad eas res conficiendas Orgetorix deligitur. Is sibi legationem ad civitates suscipit. In eo itinere persuadet Castico, Catamantaloedis filio, Sequano, cuius pater regnum in Sequanis multos annos obtinuerat et a senatu populi Romani amicus appellatus erat, ut regnum in civitate sua occuparet, quod pater ante habuerit; itemque Dumnorigi Haeduo, fratri Diviciaci, qui eo tempore principatum in civitate obtinebat ac maxime plebi acceptus erat, ut idem conaretur persuadet eique filiam suam in matrimonium dat. Perfacile factu esse illis probat conata perficere, propterea quod ipse suae civitatis imperium obtenturus esset: non esse dubium quin totius Galliae plurimum Helvetii possent; se suis copiis suoque exercitu illis regna conciliaturum confirmat. Hac oratione adducti inter se fidem et ius iurandum dant et regno occupato per tres potentissimos ac firmissimos populos totius Galliae sese potiri posse sperant. Ea res est Helvetiis per indicium enuntiata. Moribus suis Orgetoricem ex vinculis causam dicere coegerunt; damnatum poenam sequi oportebat, ut igni cremaretur. Die constituta causae dictionis Orgetorix ad iudicium omnem suam familiam, ad hominum milia decem, undique coegit, et omnes clientes obaeratosque suos, quorum magnum numerum habebat, eodem conduxit; per eos ne causam diceret se eripuit. Cum civitas ob eam rem incitata armis ius suum exequi conaretur multitudinemque hominum ex agris magistratus cogerent, Orgetorix mortuus est; neque abest suspicio, ut Helvetii arbitrantur, quin ipse sibi mortem consciverit. Post eius mortem nihilo minus Helvetii id quod constituerant facere conantur, ut e finibus suis exeant. Ubi iam se ad eam rem paratos esse arbitrati sunt, oppida sua omnia, numero ad duodecim, vicos ad quadringentos, reliqua privata aedificia incendunt; frumentum omne, praeter quod secum portaturi erant, comburunt, ut domum reditionis spe sublata paratiores ad omnia pericula subeunda essent; trium mensum molita cibaria sibi quemque domo efferre iubent. Persuadent Rauracis et Tulingis et Latobrigis finitimis, uti eodem usi consilio oppidis suis vicisque exustis una cum iis proficiscantur, Boiosque, qui trans Rhenum incoluerant et in agrum Noricum transierant Noreiamque oppugnabant, receptos ad se socios sibi adsciscunt. Erant omnino itinera duo, quibus itineribus domo exire possent: unum per Sequanos, angustum et difficile, inter montem Iuram et flumen Rhodanum, vix qua singuli carri ducerentur, mons autem altissimus impendebat, ut facile perpauci prohibere possent; alterum per provinciam nostram, multo facilius atque expeditius, propterea quod inter fines Helvetiorum et Allobrogum, qui nuper pacati erant, Rhodanus fluit isque non nullis locis vado transitur. Extremum oppidum Allobrogum est proximumque Helvetiorum finibus Genava. Ex eo oppido pons ad Helvetios pertinet. Allobrogibus sese vel persuasuros, quod nondum bono animo in populum Romanum viderentur, existimabant vel vi coacturos ut per suos fines eos ire paterentur. Omnibus rebus ad profectionem comparatis diem dicunt, qua die ad ripam Rhodani omnes conveniant. Is dies erat a. d. V. Kal. Apr. L. Pisone, A. Gabinio consulibus. Caesari cum id nuntiatum esset, eos per provinciam nostram iter facere conari, maturat ab urbe proficisci et quam maximis potest itineribus in Galliam ulteriorem contendit et ad Genavam pervenit. Provinciae toti quam maximum potest militum numerum imperat (erat omnino in Gallia ulteriore legio una), pontem, qui erat ad Genavam, iubet rescindi. Ubi de eius adventu Helvetii certiores facti sunt, legatos ad eum mittunt nobilissimos civitatis, cuius legationis Nammeius et Verucloetius principem locum obtinebant, qui dicerent sibi esse in animo sine ullo maleficio iter per provinciam facere, propterea quod aliud iter haberent nullum: rogare ut eius voluntate id sibi facere liceat. Caesar, quod memoria tenebat L. Cassium consulem occisum exercitumque eius ab Helvetiis pulsum et sub iugum missum, concedendum non putabat; neque homines inimico animo, data facultate per provinciam itineris faciundi, temperaturos ab iniuria et maleficio existimabat. Tamen, ut spatium intercedere posset dum milites quos imperaverat convenirent, legatis respondit diem se ad deliberandum sumpturum: si quid vellent, ad Id. April. reverterentur. Interea ea legione quam secum habebat militibusque, qui ex provincia convenerant, a lacu Lemanno, qui in flumen Rhodanum influit, ad montem Iuram, qui fines Sequanorum ab Helvetiis dividit, milia passuum XVIIII murum in altitudinem pedum sedecim fossamque perducit. Eo opere perfecto praesidia disponit, castella communit, quo facilius, si se invito transire conentur, prohibere possit. Ubi ea dies quam constituerat cum legatis venit et legati ad eum reverterunt, negat se more et exemplo populi Romani posse iter ulli per provinciam dare et, si vim facere conentur, prohibiturum ostendit. Helvetii ea spe deiecti navibus iunctis ratibusque compluribus factis, alii vadis Rhodani, qua minima altitudo fluminis erat, non numquam interdiu, saepius noctu si perrumpere possent conati, operis munitione et militum concursu et telis repulsi, hoc conatu destiterunt. Relinquebatur una per Sequanos via, qua Sequanis invitis propter angustias ire non poterant. His cum sua sponte persuadere non possent, legatos ad Dumnorigem Haeduum mittunt, ut eo deprecatore a Sequanis impetrarent. Dumnorix gratia et largitione apud Sequanos plurimum poterat et Helvetiis erat amicus, quod ex ea civitate Orgetorigis filiam in matrimonium duxerat, et cupiditate regni adductus novis rebus studebat et quam plurimas civitates suo beneficio habere obstrictas volebat. Itaque rem suscipit et a Sequanis impetrat ut per fines suos Helvetios ire patiantur, obsidesque uti inter sese dent perficit: Sequani, ne itinere Helvetios prohibeant, Helvetii, ut sine maleficio et iniuria transeant. Caesari renuntiatur Helvetiis esse in animo per agrum Sequanorum et Haeduorum iter in Santonum fines facere, qui non longe a Tolosatium finibus absunt, quae civitas est in provincia. Id si fieret, intellegebat magno cum periculo provinciae futurum ut homines bellicosos, populi Romani inimicos, locis patentibus maximeque frumentariis finitimos haberet. Ob eas causas ei munitioni quam fecerat T. Labienum legatum praeficit; ipse in Italiam magnis itineribus contendit duasque ibi legiones conscribit et tres, quae circum Aquileiam hiemabant, ex hibernis educit et, qua proximum iter in ulteriorem Galliam per Alpes erat, cum his quinque legionibus ire contendit. Ibi Ceutrones et Graioceli et Caturiges locis superioribus occupatis itinere exercitum prohibere conantur. Compluribus his proeliis pulsis ab Ocelo, quod est oppidum citerioris provinciae extremum, in fines Vocontiorum ulterioris provinciae die septimo pervenit; inde in Allobrogum fines, ab Allobrogibus in Segusiavos exercitum ducit. Hi sunt extra provinciam trans Rhodanum primi. Helvetii iam per angustias et fines Sequanorum suas copias traduxerant et in Haeduorum fines pervenerant eorumque agros populabantur. Haedui, cum se suaque ab iis defendere non possent, legatos ad Caesarem mittunt rogatum auxilium: ita se omni tempore de populo Romano meritos esse ut paene in conspectu exercitus nostri agri vastari, liberi [eorum] in servitutem abduci, oppida expugnari non debuerint. Eodem tempore quo Haedui Ambarri, necessarii et consanguinei Haeduorum, Caesarem certiorem faciunt sese depopulatis agris non facile ab oppidis vim hostium prohibere. Item Allobroges, qui trans Rhodanum vicos possessionesque habebant, fuga se ad Caesarem recipiunt et demonstrant sibi praeter agri solum nihil esse reliqui. Quibus rebus adductus Caesar non expectandum sibi statuit dum, omnibus, fortunis sociorum consumptis, in Santonos Helvetii pervenirent. Flumen est Arar, quod per fines Haeduorum et Sequanorum in Rhodanum influit, incredibili lenitate, ita ut oculis in utram partem fluat iudicari non possit. Id Helvetii ratibus ac lintribus iunctis transibant. Ubi per exploratores Caesar certior factus est tres iam partes copiarum Helvetios id flumen traduxisse, quartam vero partem citra flumen Ararim reliquam esse, de tertia vigilia cum legionibus tribus e castris profectus ad eam partem pervenit quae nondum flumen transierat. Eos impeditos et inopinantes adgressus magnam partem eorum concidit; reliqui sese fugae mandarunt atque in proximas silvas abdiderunt. Is pagus appellabatur Tigurinus; nam omnis civitas Helvetia in quattuor pagos divisa est. Hic pagus unus, cum domo exisset, patrum nostrorum memoria L. Cassium consulem interfecerat et eius exercitum sub iugum miserat. Ita sive casu sive consilio deorum immortalium quae pars civitatis Helvetiae insignem calamitatem populo Romano intulerat, ea princeps poenam persolvit. Qua in re Caesar non solum publicas, sed etiam privatas iniurias ultus est, quod eius soceri L. Pisonis avum, L. Pisonem legatum, Tigurini eodem proelio quo Cassium interfecerant. Hoc proelio facto reliquas copias Helvetiorum ut consequi posset, pontem in Arari faciendum curat atque ita exercitum traducit. Helvetii repentino eius adventu commoti cum id quod ipsi diebus XX aegerrime confecerant, ut flumen transirent, illum uno die fecisse intellegerent, legatos ad eum mittunt; cuius legationis Divico princeps fuit, qui bello Cassiano dux Helvetiorum fuerat. Is ita cum Caesare egit: si pacem populus Romanus cum Helvetiis faceret, in eam partem ituros atque ibi futuros Helvetios ubi eos Caesar constituisset atque esse voluisset; sin bello persequi perseveraret, reminisceretur et veteris incommodi populi Romani et pristinae virtutis Helvetiorum. Quod improviso unum pagum adortus esset, cum ii qui flumen transissent suis auxilium ferre non possent, ne ob eam rem aut suae magnopere virtuti tribueret aut ipsos despiceret. Se ita a patribus maioribusque suis didicisse, ut magis virtute contenderent quam dolo aut insidiis niterentur. Quare ne committeret ut is locus ubi constitissent ex calamitate populi Romani et internecione exercitus nomen caperet aut memoriam proderet.";

describe('Continuation', () => {
  describe('manual splitting tests', () => {
    it('splits a single oversized payload field into two Cubes', async () => {
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.fields.insertFieldBeforeBackPositionals(payloadMacrofield);

      // just assert our macro Cube looks like what we expect
      expect(macroCube.fields.all.length).toEqual(4);
      expect(macroCube.fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(macroCube.fields.all[1].type).toEqual(cciFieldType.PAYLOAD);
      expect(macroCube.fields.all[2].type).toEqual(cciFieldType.DATE);
      expect(macroCube.fields.all[3].type).toEqual(cciFieldType.NONCE);

      // run the test
      const splitCubes = await Continuation.Split(macroCube, { requiredDifficulty: 0 });

      expect(splitCubes.length).toEqual(2);

      expect(splitCubes[0].fields.getByteLength()).toEqual(1024);
      expect(splitCubes[0].fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(splitCubes[0].fields.all[1].type).toEqual(cciFieldType.RELATES_TO);
      expect(splitCubes[0].fields.all[2].type).toEqual(cciFieldType.PAYLOAD);
      expect(splitCubes[0].fields.all[3].type).toEqual(cciFieldType.DATE);
      expect(splitCubes[0].fields.all[4].type).toEqual(cciFieldType.NONCE);
      expect(splitCubes[0].fields.all.length).toEqual(5);

      const expectedFirstChunkPayloadLength = 1024  // Cube size
        - 1  // Type
        - 2  // two byte Payload TLV header (type and length)
        - 34 // RELATES_TO/CONTINUED_IN (1 byte type and 33 byte value)
        - 5  // Date
        - 4  // Nonce
      expect(splitCubes[0].fields.all[2].value.length).toEqual(expectedFirstChunkPayloadLength);

      const rel = cciRelationship.fromField(splitCubes[0].fields.all[1]);
      expect(rel.type).toBe(cciRelationshipType.CONTINUED_IN);
      expect(rel.remoteKey).toEqual(await splitCubes[1].getKey());

      // chunks are automatically padded up
      expect(splitCubes[1].fields.all[0].type).toEqual(cciFieldType.TYPE);
      expect(splitCubes[1].fields.all[1].type).toEqual(cciFieldType.PAYLOAD);
      expect(splitCubes[1].fields.all[2].type).toEqual(cciFieldType.CCI_END);
      expect(splitCubes[1].fields.all[3].type).toEqual(cciFieldType.PADDING);
      expect(splitCubes[1].fields.all[4].type).toEqual(cciFieldType.DATE);
      expect(splitCubes[1].fields.all[5].type).toEqual(cciFieldType.NONCE);

      expect(splitCubes[1].fields.all[1].value.length).toEqual(
        payloadMacrofield.value.length - expectedFirstChunkPayloadLength);
    });
  });  // manual splitting

  describe('round-trip tests', () => {
    it('splits and restores a single overly large payload field requiring two chunks', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      cciFields;
      const payloadMacrofield = cciField.Payload(tooLong);
      macroCube.fields.insertFieldBeforeBackPositionals(payloadMacrofield);

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toEqual(2);
      const recombined: cciCube = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      expect(recombined.fields.get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.fields.getFirst(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(tooLong);
    });

    it('splits and restores a single extremely large payload field requiring more than chunks', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      const payloadMacrofield = cciField.Payload(farTooLong);
      macroCube.fields.insertFieldBeforeBackPositionals(payloadMacrofield);

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toBeGreaterThan(11);
      const recombined: cciCube = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      expect(recombined.fields.get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.fields.getFirst(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(farTooLong);
    });

    it('splits and restores a long array of small fixed-length fields', async () => {
      const numFields = 500;
      // prepare macro Cube
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [];
      // add 3000 media type fields, with content alternating between two options
      for (let i=0; i < numFields; i++) {
        if (i%2 == 0) manyFields.push(cciField.MediaType(MediaTypes.TEXT));
        else manyFields.push(cciField.MediaType(MediaTypes.JPEG));
      }
      for (const field of manyFields) {
        macroCube.fields.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get(cciFieldType.MEDIA_TYPE).length;
      }
      expect(targetFieldsInSplit).toEqual(numFields);


      // recombine the chunks
      const recombined: cciCube = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      const manyRestoredFields = recombined.fields.get(cciFieldType.MEDIA_TYPE);
      expect(manyRestoredFields.length).toEqual(numFields);
      for (let i=0; i < numFields; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('splits and restores a long array of small variable-length fields', async () => {
      const numFields = 500;
      // prepare macro Cube
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      const manyFields: cciField[] = [];
      // add 3000 DESCRIPTION fields, using a running number as content
      for (let i=0; i < numFields; i++) {
        manyFields.push(cciField.Description(i.toString()));
      }
      for (const field of manyFields) {
        macroCube.fields.insertFieldBeforeBackPositionals(field);
      }

      // split the Cube
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});

      // run some tests on the chunks: ensure that the total number of target
      // fields in the split is correct
      let targetFieldsInSplit = 0;
      for (const cube of splitCubes) {
        targetFieldsInSplit += cube.fields.get(cciFieldType.DESCRIPTION).length;
      }
      expect(targetFieldsInSplit).toEqual(numFields);

      // recombine the chunks
      const recombined: cciCube = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      const manyRestoredFields = recombined.fields.get(cciFieldType.DESCRIPTION);
      expect(manyRestoredFields.length).toEqual(numFields);
      for (let i=0; i < numFields; i++) {
        expect(manyRestoredFields[i].value).toEqual(manyFields[i].value);
      }
    });

    it('preserves all CCI relationship except CONTINUED_IN', async () => {
      // prepare macro Cube
      const macroCube = cciCube.Create(CubeType.FROZEN, {
        requiredDifficulty: 0,
      });
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.Payload(tooLong));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MYPOST, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.MENTION, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));
      macroCube.fields.insertFieldBeforeBackPositionals(cciField.RelatesTo(
        new cciRelationship(cciRelationshipType.CONTINUED_IN, Buffer.alloc(NetConstants.CUBE_KEY_SIZE, 42))));

      // run the test: split, then recombine
      const splitCubes: cciCube[] = await Continuation.Split(macroCube, {requiredDifficulty: 0});
      expect(splitCubes.length).toEqual(2);
      const recombined: cciCube = Continuation.Recombine(splitCubes, {requiredDifficulty: 0});

      // assert that payload was correctly restored
      expect(recombined.fields.get(cciFieldType.PAYLOAD).length).toEqual(1);
      const restoredPayload = recombined.fields.getFirst(cciFieldType.PAYLOAD);
      expect(restoredPayload.valueString).toEqual(tooLong);

      // assert that the number of RELATES_TO fields is the number of
      // non-CONTINUED_IN relationships
      const restoredRelatesTo = recombined.fields.get(cciFieldType.RELATES_TO);
      expect(restoredRelatesTo.length).toEqual(4);
      expect(cciRelationship.fromField(restoredRelatesTo[0]).type).toEqual(cciRelationshipType.MYPOST);
      expect(cciRelationship.fromField(restoredRelatesTo[1]).type).toEqual(cciRelationshipType.MENTION);
      expect(cciRelationship.fromField(restoredRelatesTo[2]).type).toEqual(cciRelationshipType.MYPOST);
      expect(cciRelationship.fromField(restoredRelatesTo[3]).type).toEqual(cciRelationshipType.MENTION);
    });

    it.todo('splits and restores random oversized Cubes (fuzzing test)');
  });
});