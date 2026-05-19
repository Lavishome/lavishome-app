import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD1lHiiTIMQ2ZBux9Kt_el_iW3yszdd1Ck",
  authDomain: "lavishome.firebaseapp.com",
  projectId: "lavishome",
  storageBucket: "lavishome.firebasestorage.app",
  messagingSenderId: "787997823088",
  appId: "1:787997823088:web:d90b61470d26f7dd07a4b5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
