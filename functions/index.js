const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors({ origin: true }));

const admin = require("firebase-admin");
admin.initializeApp();

app.get("/", (req, res) => {
  res.send("Hello Lapsee!");
});

app.get("/questions/random", async (req, res) => {
  console.log("get /questions/random");
  try {
    const snapShot = await admin.database().ref("/questions").once("value");
    const questions = snapShot.val();
    if (!questions) {
      return res.send([]);
    }

    const length = questions.length;
    const NUM_DRAW = 10;
    if (length < NUM_DRAW) {
      return res.send(questions);
    }

    // Fisher-Yates Shuffle
    // random [0,1)，每次在 i 到 length-1 之中抽一個數字擺到前面，抽 10 個
    const arr = [...Array(length).keys()];
    for (let i = 0; i < NUM_DRAW; i++) {
      const j = Math.floor(Math.random() * (length - i)) + i;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    const result = arr.slice(0, NUM_DRAW).map((num) => questions[num]);
    res.send(result);
  } catch (error) {
    console.log(error);
    res.status(500).send("something went wrong!");
  }
});

app.get("/rank/:game", async (req, res) => {
  const game = req.params.game;
  console.log("get /rank/" + game);
  try {
    const snapShot = await admin
      .database()
      .ref("/rank/" + game)
      .once("value");
    const curRank = snapShot.val();

    if (!curRank) return res.send([]);
    res.send(curRank);
  } catch (error) {
    console.log(error);
    res.status(500).send("something went wrong!");
  }
});

app.post("/rank/:game", async (req, res) => {
  const game = req.params.game;
  const { name, score } = req.body;
  console.log(`post /rank/${game} ${name} ${score}`);
  try {
    const rankRef = admin.database().ref("/rank/" + game);
    const snapShot = await rankRef.once("value");
    let curRank = snapShot.val();
    if (!curRank) {
      curRank = [{ name, score }];
    } else {
      let inserted = false;
      for (let i = 0; i < curRank.length; i++) {
        if (score >= curRank[i].score) {
          curRank.splice(i, 0, { name, score });
          inserted = true;
          break;
        }
      }
      if (!inserted && curRank.length < 10) {
        curRank.push({ name, score });
      }
    }
    const newRank = curRank.slice(0, 10);
    await rankRef.set(newRank);
    res.send(newRank);
  } catch (error) {
    console.log(error);
    res.status(500).send("something went wrong!");
  }
});

exports.api = functions.region("asia-east1").https.onRequest(app);
