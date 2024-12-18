import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  // firebase config
  apiKey: "AIzaSyAt-flcNDE2Rgn3d0bmlZkeXqKX1rzyU_k",
  authDomain: "webapprtc-e54f6.firebaseapp.com",
  projectId: "webapprtc-e54f6",
  storageBucket: "webapprtc-e54f6.firebasestorage.app",
  messagingSenderId: "148672731304",
  appId: "1:148672731304:web:46dadc4b6fbc6f1ba6ca9d"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
let pc = null;
let localCamStream = null;
let screenStream = null;
let userAudioStream = null;
let remoteStream = null;
let remoteCamStream = null;

// HTML elements
const shareScreenButton = document.getElementById('shareScreenButton')
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

function createPeerConnection() {
  pc = new RTCPeerConnection(servers);
}

// 1. Screen shared sources

shareScreenButton.onclick = async () => {

  callButton.style.disabled = false;

  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, });
  userAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const combinedStream = new MediaStream();
  remoteStream = new MediaStream();

  createPeerConnection();

  screenStream.getTracks().forEach((track) => {
    combinedStream.addTrack(track, screenStream);
  });

  userAudioStream.getTracks().forEach((track) => {
    combinedStream.addTrack(track, userAudioStream);
  });

  combinedStream.getTracks().forEach((track) => {
    pc.addTrack(track, combinedStream);
  });

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };
  webcamVideo.srcObject = combinedStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
};

// 2. Create an offer
callButton.onclick = async () => {

  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  answerButton.disabled = true;
  callInput.disabled = true;
  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  callButton.disabled = true;
  hangupButton.disabled = false;
};

//6. Hang up the call
hangupButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  if (pc) {
    pc.close();
    pc = null;
  }

  const deleteCollection = async (collection) => {
    const snapshot = await collection.get();
    snapshot.forEach(async (doc) => {
      await doc.ref.delete();
    });
  };

  await deleteCollection(offerCandidates)
  await deleteCollection(answerCandidates)

  await callDoc.delete();
  
  // Stop local tracks and reset UI

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  if (userAudioStream) {
    userAudioStream.getTracks().forEach((track) => track.stop());
    userAudioStream = null;
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
    remoteStream = null;
  }

  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;
  callInput.value = "";
}