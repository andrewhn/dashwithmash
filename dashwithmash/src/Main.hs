module Main where

import Control.Exception (finally)
import Control.Monad (forM_, forever)
import Control.Concurrent (MVar, newMVar, modifyMVar_, modifyMVar, readMVar)
import Data.List (cycle)
import qualified Control.Applicative as A
import qualified Data.Text as T
import qualified Data.Map as M
import qualified Network.WebSockets as WS
import qualified Data.Aeson as Aeson
import qualified GHC.Generics as G
import qualified Data.UUID.V4 as UUID
import qualified Data.Vector as V
import Reactive.Banana
import Reactive.Banana.Frameworks

type BroadcastFn = T.Text -> Aeson.Value -> IO ()
type ListenActn = IO (Maybe Payload)
type PlayerId = T.Text
type GameId = T.Text
type PlayerName = T.Text

data AppState = AppState { gameMap :: M.Map GameId Game
                         , playerMap :: M.Map PlayerId (PlayerName, GameId)
                         }

data Game = Game { gameId :: GameId
                 , network :: EventNetwork
                 , fireSocketEvent :: Handler (Player, Payload)
                 }

data Player = Player { playerId :: PlayerId
                     , name :: PlayerName
                     , broadcast :: BroadcastFn
                     , listen :: ListenActn
                     }

data Payload = Payload { action :: Action
                       , payload :: Aeson.Value
                       }
  deriving (G.Generic, Show)

instance Aeson.FromJSON Payload

data Action = Start
            | Join
            | Create
            | Identify
            | Rejoin
            | Reset
            | CategoryChange
            | ClueChange
            | Answer
            | Leave
            | AddVote
            | RemoveVote
            | CalculateScores
  deriving (Read, Show, Eq, Enum)

instance Aeson.FromJSON Action where
    parseJSON (Aeson.String s)
        | s == "start" = return Start
        | s == "join" = return Join
        | s == "re-join" = return Rejoin
        | s == "identify" = return Identify
        | s == "create" = return Create
        | s == "category-change" = return CategoryChange
        | s == "clue-change" = return ClueChange
        | s == "answer" = return Answer
        | s == "leave" = return Leave
        | s == "add-vote" = return AddVote
        | s == "remove-vote" = return RemoveVote
        | s == "calculate-scores" = return CalculateScores
    parseJSON _ = A.empty

data GameState = Waiting
               | Answering
               | Reading
               | ShowingScores
  deriving (Show)

genId :: Int -> IO T.Text
genId n = UUID.nextRandom >>= return . T.pack . take n . filter ((/=) '-') . show

getPayload :: WS.Connection -> IO (Maybe Payload)
getPayload conn = WS.receiveData conn >>= return . Aeson.decode

main :: IO ()
main = do
  print "Starting dashwithmash server on 127.0.0.1:9160"
  appState <- newMVar $ AppState M.empty M.empty
  WS.runServer "127.0.0.1" 9160 $ application appState

application :: MVar AppState -> WS.ServerApp
application state pending = do
  conn <- WS.acceptRequest pending
  WS.forkPingThread conn 30
  initiate conn state

makeNetworkDescription :: AddHandler (Player, Payload)
                       -> MomentIO ()
makeNetworkDescription addSocketEvent = mdo
  -- external events
  eSocket <- fromAddHandler addSocketEvent

  -- bust out a payload into events relating to action
  let eStart = pick Start eSocket
      eJoin = pick Join eSocket
      eCreate = pick Create eSocket
      eIdentify = pick Identify eSocket
      eRejoin = pick Rejoin eSocket
      eReset = pick Reset eSocket
      eCategoryChange = pick CategoryChange eSocket
      eClueChange = pick ClueChange eSocket
      eAnswer = pick Answer eSocket
      eLeave = pick Leave eSocket
      eAddVote = pick AddVote eSocket
      eRemoveVote = pick RemoveVote eSocket
      eCalculateScores = pick CalculateScores eSocket
      -- derived events
      eNewPlayer = pickMany [Create, Join] eSocket
      eNewRound = pickMany [Start, Reset] eSocket

  -- endogenous events
  eGameState <- accumE Waiting $ unions [ (\ep _ -> Answering) <$> eNewRound
                                        ]
  -- maintain a map of players (so we can broadcast events)
  -- the map needs to be updated on re-join, as the broadcast function
  -- changes with the new connection
  bPlayers <- accumB M.empty $ unions [ (\(pl, pa) m -> M.insert (playerId pl) pl m) <$> eNewPlayer
                                      , (\(pl, pa) m -> M.adjust (const pl) (playerId pl) m) <$> eRejoin
                                      ] :: MomentIO (Behavior (M.Map PlayerId Player))
  let bDasherOrder = cycle . shuffle . values <$> bPlayers :: Behavior [Player]
  bRound <- accumB 0 $ (\enr x -> x + 1) <$> eNewRound :: MomentIO (Behavior Int)  -- number of games played
  let bDasher = (!!) <$> bDasherOrder <*> bRound :: Behavior Player
      bNonDasherPlayers = (\ps d -> filter ((==) (playerId d) . playerId) (values ps)) <$> bPlayers <*> bDasher:: Behavior [Player]

      -- ongoing

  reactimate $ (\(pl, pa) -> putStrLn (show pa)) <$> eSocket
  reactimate $ (\s -> putStrLn $ "gamestate: " ++ (show s)) <$> eGameState
  reactimate $ onNewPlayer <$> bPlayers <@ eNewPlayer

  return ()
  where
    pick a = filterE ((==) a . action . snd)--(\b -> a == action b)
    pickMany as = filterE ((flip elem) as . action . snd)--(\b -> a == action b)
    values v = map snd (M.toList v)
    onNewPlayer pm = let vs = values pm
                         namelist = Aeson.Array $ V.fromList $ map (Aeson.String . name) vs
                     in mapM_ (\p -> (broadcast p) "joined" namelist) vs
    shuffle xs = xs

initiate :: WS.Connection
         -> MVar AppState
         -> IO ()
initiate conn state =
  -- make the send/recieve functions for this connection
  let broadcast action payload = WS.sendTextData conn $
        Aeson.encode $ Aeson.object [ "action" Aeson..= action , "payload" Aeson..= payload ]
      listen = getPayload conn
  in forever $ do
    -- wait for authentication payload; can't do anything until authenticated
    recv <- listen
    case recv of
      Just p -> case action p of
                  Identify -> case (payload p) of
                                Aeson.String n -> genId 8 >>= \pid -> do
                                                    broadcast "got-name" (Aeson.String pid)
                                                    waiting (Player pid n broadcast listen) state
                                _              -> broadcast "error" "invalid-payload"
                  Rejoin   -> case (payload p) of
                                Aeson.String pid -> do
                                  (AppState _ pm) <- readMVar state
                                  case M.lookup pid pm of
                                    Just (n, gid) -> joinGame (Player pid n broadcast listen) p state gid
                                    Nothing  -> broadcast "error" "game-not-found"
                                _                -> broadcast "error" "invalid-payload"
                  _        -> broadcast "error" "player-not-found"
      _      -> broadcast "error" "invalid-payload"

joinGame :: Player
         -> Payload
         -> MVar AppState
         -> GameId
         -> IO ()
joinGame player payload state gid = do
  appState <- readMVar state
  case M.lookup gid (gameMap appState) of
    Just (Game _ _ f) -> do
      -- fire the join payload (so the network knows what to do)
      f (player, payload)
      -- add to the player -> game map so we can re-join
      modifyMVar_ state (\(AppState g p) -> return $ AppState g (M.insert (playerId player) (name player, gid) p))
      let handle p = case p of
            Just pl -> f (player, pl)
            Nothing -> (broadcast player) "error" "invalid-payload"
      forever $ listen player >>= handle
    Nothing           -> (broadcast player) "error" "game-not-found"

waiting :: Player
        -> MVar AppState
        -> IO ()
waiting player state = forever $ do
    recv <- listen player
    case recv of
      Just p -> case action p of
                  Create -> createGame player state >>= joinGame player p state
                  Join   -> case (payload p) of
                              Aeson.String gid -> joinGame player p state gid
                              _                -> (broadcast player) "error" "invalid-payload"
                  _      -> (broadcast player) "error" "invalid-action"
      _      -> (broadcast player) "error" "parsing-json"

createGame :: Player
           -> MVar AppState
           -> IO GameId
createGame player state = do
  gid <- genId 4
  (addSocketEvent, fireSocketEvent) <- newAddHandler
  network <- compile $ makeNetworkDescription addSocketEvent
  actuate network
  -- TODO: need network here?
  let game = Game gid network fireSocketEvent
  modifyMVar_ state (\(AppState g p) -> return $ AppState (M.insert gid game g) p)
  (broadcast player) "created" (Aeson.String gid)
  return gid
