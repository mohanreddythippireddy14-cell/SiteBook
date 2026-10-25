import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  signInWithCredential,
  linkWithCredential,
} from 'firebase/auth';
import { auth } from './firebase';

const getExpoConfig = () => Constants.expoConfig || Constants.manifest;

const getAuthSession = () => require('expo-auth-session');
const getGoogleProvider = () => require('expo-auth-session/providers/google');

export const getGoogleAuthConfig = () => {
  const extra = getExpoConfig()?.extra?.googleAuth || {};
  const { webClientId, iosClientId, androidClientId } = extra;
  const AuthSession = getAuthSession();

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'sitebook',
  });

  const extraParams = {
    prompt: 'consent',
  };

  // Web implicit flow (response_type=token) does not allow access_type=offline
  if (Platform.OS !== 'web') {
    extraParams.access_type = 'offline';
  }

  return {
    webClientId,
    iosClientId,
    androidClientId: androidClientId || webClientId,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    redirectUri,
    extraParams,
  };
};

export const useGoogleAuthRequest = () => {
  try {
    const Google = getGoogleProvider();
    const config = getGoogleAuthConfig();
    return Google.useAuthRequest(config);
  } catch (e) {
    console.warn('Google auth unavailable:', e);
    return [
      null,
      null,
      async () => {
        throw new Error('Google Sign-In is unavailable in this build.');
      },
    ];
  }
};

const pickToken = (response, key) => {
  return response?.authentication?.[key] || response?.params?.[key] || null;
};

export const completeGoogleSignIn = async (response) => {
  if (!response || response.type !== 'success') {
    return { cancelled: true };
  }

  const accessToken = pickToken(response, 'accessToken') || pickToken(response, 'access_token');
  const idToken = pickToken(response, 'idToken') || pickToken(response, 'id_token');
  const refreshToken = pickToken(response, 'refreshToken') || pickToken(response, 'refresh_token');
  const expiresIn = response?.authentication?.expiresIn || null;
  const expiresAt = response?.authentication?.accessTokenExpirationDate
    ? new Date(response.authentication.accessTokenExpirationDate).getTime()
    : (expiresIn ? Date.now() + expiresIn * 1000 : null);

  if (!accessToken && !idToken) {
    throw new Error('Google sign-in did not return a token.');
  }

  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const currentUser = auth.currentUser;

  let userCred = null;
  if (currentUser && currentUser.isAnonymous) {
    try {
      userCred = await linkWithCredential(currentUser, credential);
    } catch (e) {
      if (e?.code === 'auth/credential-already-in-use') {
        // FIX P0H1: Block UID switching so anonymous SiteBook records are not hidden behind another Google account.
        throw new Error('This Google account is already linked to another SiteBook profile. Please use a different Google account or contact support to merge your data.');
      } else {
        throw e;
      }
    }
  } else {
    userCred = await signInWithCredential(auth, credential);
  }

  return {
    user: userCred.user,
    tokens: {
      accessToken: accessToken || null,
      idToken: idToken || null,
      refreshToken: refreshToken || null,
      expiresAt,
    },
  };
};
