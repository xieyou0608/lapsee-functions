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

// 知識王: 抽十個文字題目
app.get("/questions/random", async (req, res) => {
  console.log("get /questions/random");
  try {
    const snapshot = await admin.database().ref("/questions").once("value");
    const questions = snapshot.val();
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

// 取得 rank
app.get("/rank/:game", async (req, res) => {
  const game = req.params.game;
  console.log("get /rank/" + game);
  try {
    const snapshot = await admin
      .database()
      .ref("/rank/" + game)
      .once("value");
    const curRank = snapshot.val();

    if (!curRank) return res.send([]);
    res.send(curRank);
  } catch (error) {
    console.log(error);
    res.status(500).send("something went wrong!");
  }
});

// 提交分數
app.post("/rank/:game", async (req, res) => {
  const game = req.params.game;
  const { name, score } = req.body;
  console.log(`post /rank/${game} ${name} ${score}`);
  try {
    const rankRef = admin.database().ref("/rank/" + game);
    const snapshot = await rankRef.once("value");
    let curRank = snapshot.val();
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

// *****線上遊戲*****

// 知識王
// 1. 建立房間，由前端執行
// 2. 玩家進房，由前端執行 第一個人 A，第二個人 B
// 3. 倒數開始，由前端執行 status: "counting"
// 4. 遊戲開始，由前端執行 status: "playing"
// 5. 玩家答題

// 方法一: transaction
// 不能在這裡 setTimeout，在 functions setTimeout 的時間會計費
// 改成先更新 backEndRound，但前端顯示的 round 另外處理來做一些答題延遲
exports.chooseAnswer = functions
  .region("asia-east1")
  .database.ref("/onlineRoom/quiz/{roomId}/playerChosen/{roundNum}/{userId}")
  .onCreate(async (snapshot, context) => {
    const { roomId, roundNum, userId } = context.params;
    const chosen = snapshot.val().chosen;
    const roomRef = snapshot.ref.parent.parent.parent;
    console.log(`[${roomId}] round ${roundNum}: ${userId} choose ${chosen}`);

    return roomRef.transaction((room) => {
      if (room === null) {
        return null;
      }
      // console.log("transaction", userId);
      const { questions, players, playerChosen, round } = room;
      if (chosen === questions[round].answer) {
        room.players[userId].combo += 1;
        room.players[userId].score += 100;
      } else {
        room.players[userId].combo = 0;
      }
      room.playerChosen[round][userId].judged = true;

      // 重要: 兩個人同時選答案的話
      // 兩個 trigger functions 有可能同時拿到長度=2的 playerChosen
      // 用 judged 來判斷才安全
      const chosenObj = playerChosen[round];
      if (Object.keys(chosenObj).length === 2) {
        const [A, B] = Object.keys(chosenObj);
        const roundEnd = chosenObj[A].judged && chosenObj[B].judged;
        if (roundEnd) {
          if (round === 9) {
            if (players[A].score > players[B].score) {
              room.endMessage = `${players[A].userName} 贏了!`;
            } else if (players[A].score < players[B].score) {
              room.endMessage = `${players[B].userName} 贏了!`;
            } else {
              room.endMessage = "平手!";
            }
          }
          // 前端會 handle round = 10，代表結束
          room.round += 1;
        }
      }
      return room;
    });
  });

// // 方法二: Atomic server-side increments
// exports.updateChosen = functions
//   .region("asia-east1")
//   .database.ref(
//     "/onlineRoom/quiz/{roomId}/playerChosen/{roundNum}/{userId}/foo/bar/foo"
//   )
//   .onCreate(async (snapshot, context) => {
//     const { roomId, roundNum, userId } = context.params;
//     const chosen = snapshot.val().chosen;

//     const roomRef = snapshot.ref.parent.parent.parent;
//     const roomSnap = await roomRef.once("value");
//     const roomInfo = roomSnap.val();
//     const { questions, players } = roomInfo;

//     console.log(`[${roomId}] round ${roundNum}: ${userId} choose ${chosen}`);
//     let updates = {};
//     if (chosen === questions[roundNum].answer) {
//       updates[`/players/${userId}/combo`] = players[userId].combo + 1;
//       updates[`/players/${userId}/score`] = players[userId].score + 100;
//     } else {
//       updates[`/players/${userId}/combo`] = 0;
//     }
//     updates[`/playerChosen/${roundNum}/${userId}/judged`] = true;

//     return roomRef.update(updates);
//   });

// // judged 之後 update round
// exports.updateRound = functions
//   .region("asia-east1")
//   .database.ref(
//     "/onlineRoom/quiz/{roomId}/playerChosen/{roundNum}/{userId}/foo/bar/foo"
//   )
//   .onUpdate(async (change, context) => {
//     const roomRef = change.after.ref.parent.parent.parent;
//     return roomRef.once("value").then((snap) => {
//       const room = snap.val();
//       const { round, players, playerChosen } = room;
//       const chosenObj = playerChosen[round];
//       if (!chosenObj || Object.keys(chosenObj).length === 1) {
//         // 如果順序是 judge A, round, judge B, round，第 1 次 round 的 obj 長度為 1
//         // 如果順序是 judge A, judge B, round, round，第 2 次 round 就 obj 為 null
//         return null;
//       }
//       // obj 長度為 2
//       const [A, B] = Object.keys(chosenObj);
//       const roundEnd = chosenObj[A].judged && chosenObj[B].judged;
//       let updates = {};
//       if (roundEnd) {
//         if (round === 9) {
//           if (players[A].score > players[B].score) {
//             updates["/endMessage"] = `${players[A].userName} 贏了!`;
//           } else if (players[A].score < players[B].score) {
//             updates["/endMessage"] = `${players[B].userName} 贏了!`;
//           } else {
//             updates["/endMessage"] = "平手!";
//           }
//         } else {
//           updates["/round"] = round + 1;
//         }
//       }
//       return roomRef.update(updates);
//     });
//   });
