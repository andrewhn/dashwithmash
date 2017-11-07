from tornado import websocket, web, ioloop
import json
import uuid
import logging
import random

logging.basicConfig(level=logging.DEBUG)


mkid = lambda: str(uuid.uuid4())[:4]


class Player():

    registered = {}

    def __init__(self, conn):
        self.id = mkid()
        logging.debug("initialising player {}".format(self.id))
        self.conn = conn
        self.game = None
        Player.registered[self.id] = self

    def new_connection(self, conn):
        self.conn = conn

    def exit(self):
        """
        Exit game
        """

        logging.info("{} exiting".format(self.id))
        if self.game is not None:
            self.game.remove_player(self)
            logging.info("removing player {}".format(self.id))
            for p in self.game.players:
                p.broadcast("joined", [p.name for p in self.game.players])
            if len(self.game.players) == 1:
                logging.debug("resetting game")
                self.game.reset()
            self.game = None

    def handle_message(self, message):
        logging.info("player {} got message {}".format(self.id, json.dumps(message)))
        action = message["action"]
        if action == "identify":
            self.name = message["payload"]
            self.broadcast("got-name", self.id)  # re-join key
        elif action == "re-join":
            payload = {"name": self.name}
            if self.game is not None:
                payload.update({
                    "gameId": self.game.id,
                    "creator": self.game.creator == self,
                    "players": [p.name for p in self.game.players],
                    "category": self.game.category,
                    "clue": self.game.clue,
                    "responsesReceived": self.game.answers_received,
                })
            else:
                payload.update({
                    "creator": False,
                    "players": [],
                })
            if self.game is not None:
                ## pick up where we left off, let the player know the state of the game
                action, data = self.game.handle_rejoin(self)
                payload["next"] = {"action": action, "message": data}
            self.broadcast("re-joined", payload)
        elif action == "category-change":
            self.game.set_category(message["payload"])
        elif action == "clue-change":
            self.game.set_clue(message["payload"])
        elif action == "create":
            self.game = Game(self)
            self.game.add_player(self)
            self.broadcast("created", self.game.id)
        elif action == "join":
            try:
                game = Game.registered[message["payload"].lower()]
            except KeyError:
                return self.broadcast("error", "game-not-found")
            if game.dasher is not None:
                return self.broadcast("error", "game-in-progress")
            self.game = game
            self.game.add_player(self)
            for p in self.game.players:
                p.broadcast("joined", [p.name for p in self.game.players])
            if self.game is not None and self.game.dasher is None:
                self.broadcast("waiting", [p.name for p in self.game.players])
            else:
                self.broadcast("pls-answer", "")
        elif action == "start" or action == "reset":
            self.game.start()
        elif action == "answer":
            self.game.handle_answer(self, message["payload"])
            self.broadcast("got-answer", "")
            self.game.dasher.broadcast("player-sent-answer", self.game.answers_received)
        elif action == "leave":
            self.exit()

    def broadcast(self, action, message):
        msg = {"action": action, "message": message}
        logging.debug("player {} broadcasting {}".format(self.id, json.dumps(msg)))
        try:
            self.conn.write_message(json.dumps(msg))
        except:
            logging.error("error writing to socket")


class Game():

    registered = {}

    def __init__(self, player):
        self.id = mkid()
        self.players = []
        self._dasher_index = 0
        self.dasher = None
        self.creator = player
        self.category = None
        self.clue = None
        self.answers = {}
        Game.registered[self.id] = self

    @property
    def answers_received(self):
        return len([a for a in self.answers.values() if a])

    @property
    def formatted_answers(self):
        formatted = []
        for player in self.players:
            if player.id not in self.answers:
                logging.error("Player id not in answers: {} {}".format(player.id, self.answers))
                continue
            if player == self.dasher:
                name = "{} (Dasher)".format(player.name)
            else:
                name = player.name
            formatted.append({"name": name, "answer": self.answers[player.id]})
        random.shuffle(formatted)  # n.b. inplace
        return formatted

    def set_category(self, category, notify_dasher=False):
        self.category = category
        for player in self.players:
            if player != self.dasher or notify_dasher:
                player.broadcast("category-change", category)

    def set_clue(self, clue, notify_dasher=False):
        self.clue = clue
        for player in self.players:
            if player != self.dasher or notify_dasher:
                player.broadcast("clue-change", clue)

    def reset(self):
        self._dasher_index = 0
        self.dasher = None

    def handle_rejoin(self, player):
        ## inform re-joining player of current state of game
        if self.dasher is not None:
            ## we're in a game
            if all(a is not None for a in self.answers.values()):
                ## everyone has answered
                if self.dasher == player:
                    return ("read-answers", self.formatted_answers)
                else:
                    return ("listen-to-reading", "")
            else:
                if self.dasher == player:
                    return ("dasher", {
                        "responsesReceived": self.answers_received,
                        "answerReceived": self.answers[player.id] is not None,
                    })
                else:
                    return ("pls-answer", {
                        "answerReceived": self.answers[player.id] is not None,
                    })
                if self.answers.get(player.id, None):
                    return ("got-answer", "")
        else:
            return ("waiting", [p.name for p in self.players])

    def add_player(self, player):
        if player not in self.players:
            self.players.append(player)

    def remove_player(self, player):
        remove_idx = None
        for i, p in enumerate(self.players):
            if p.id == player.id:
                remove_idx = i
        if remove_idx is not None:
            self.players.pop(remove_idx)

    def handle_answer(self, player, answer):
        logging.debug("got answer from player " + str(player.id) + ": " + answer)
        assert player in self.players
        self.answers[player.id] = answer
        if all(a is not None for a in self.answers.values()):
            ## round is complete, send answers to dasher
            self.dasher.broadcast("read-answers", self.formatted_answers)
            for p in self.players:
                if p != self.dasher:
                    p.broadcast("listen-to-reading", "")
        else:
            for p in self.players:
                if p != player:
                    p.broadcast("answer-received", p.name)

    def start(self):
        logging.debug("starting")
        try:
            self.dasher = self.players[self._dasher_index]
        except IndexError:
            self.dasher = self.players[0]
            self._dasher_index = 0
        self.answers = {p.id: None for p in self.players}
        self._dasher_index = (self._dasher_index + 1) % len(self.players)
        self.set_category(None, notify_dasher=True)
        self.set_clue(None, notify_dasher=True)
        for p in self.players:
            if p == self.dasher:
                p.broadcast("dasher", {
                    "responsesReceived": self.answers_received,
                    "answerReceived": self.answers[p.id] is not None,
                })
            else:
                p.broadcast("pls-answer", {
                    "answerReceived": self.answers[p.id] is not None,
                })


class ConnectionHandler(websocket.WebSocketHandler):

    def check_origin(self, origin):
        return True

    def open(self):
        logging.debug("socket opened")
        pass

    def _write_error(self, msg):
        payload = {"action": "error", "message": msg}
        self.write_message(json.dumps(payload))

    def on_message(self, message):
        logging.debug("received {}".format(message))
        try:
            parsed = json.loads(message)
            ## identification correspondence
            if not hasattr(self, "_player"):
                if parsed["action"] == "identify":
                    self._player = Player(self)
                    logging.debug("creating player {} after identify".format(self._player.id))
                elif parsed["action"] == "re-join":
                    try:
                        ## look me up
                        self._player = Player.registered[parsed["payload"]]
                        self._player.new_connection(self)
                        logging.debug("player {} re-joined".format(self._player.id))
                    except:
                        return self._write_error("player-not-found")
                else:
                    return self._write_error("player-not-found")

            ## business as usual
            try:
                self._player.handle_message(parsed)
            except:
                self._write_error("unknown")
                raise
        except:
            self._write_error("parsing-json")
            raise

    def on_close(self):
        logging.debug("socket closed")


app = web.Application([
    (r'/', ConnectionHandler),
])

if __name__ == '__main__':
    app.listen(8081)
    ioloop.IOLoop.instance().start()
