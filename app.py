from tornado import websocket, web, ioloop
import json
import uuid
import logging
import random


logging.basicConfig(level=logging.DEBUG)


def make_id():
    return str(uuid.uuid4())[:4]


class Player():

    registered = {}

    def __init__(self, conn):
        self.id = make_id()
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
            logging.info("removing player {}".format(self.id))
            self.game.remove_player(self)
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
                nxt = self.game.handle_rejoin(self)
                payload.update({
                    ## administrative info
                    "gameId": self.game.id,
                    "creator": self.game.creator == self,
                    "players": [p.name for p in self.game.players],
                    ## game state info
                    "next": nxt,  # pick up where we left off
                })
            else:
                payload.update({
                    "creator": False,
                    "players": [],
                })
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
        elif action == "add-vote":
            self.game.add_vote(self, message["payload"])
        elif action == "remove-vote":
            self.game.remove_vote(self, message["payload"])
        elif action == "calculate-scores":
            self.game.calculate_scores()

    def broadcast(self, action, payload):
        msg = {"action": action, "payload": payload}
        logging.debug("player {} broadcasting {}".format(self.id, json.dumps(msg)))
        try:
            self.conn.write_message(json.dumps(msg))
        except:
            logging.error("error writing to socket")


class Game():

    registered = {}

    def __init__(self, player):
        self.id = make_id()
        self.players = []
        self._dasher_index = 0
        self.dasher = None
        self.creator = player
        self.category = None
        self.clue = None
        self.answers = {}
        self.shuffled_answers = []
        self.votes = {}  # player -> player (vote caster -> votee)
        self.scores_finalised = False
        Game.registered[self.id] = self

    @property
    def answers_received(self):
        return len([a for a in self.answers.values() if a])

    @property
    def formatted_answers(self):
        formatted = []
        for player, answer in self.shuffled_answers:
            votes = [c.name for c, v in self.votes.items() if v == player]
            formatted.append({
                "name": player.name,
                "answer": answer,
                "votes": votes
            })
        return formatted

    @property
    def yet_to_vote(self):
        return [p.name for p in self.players if p not in self.votes and p != self.dasher]

    @property
    def vote_stage_payload(self):
        return {"answers": self.formatted_answers, "yetToVote": self.yet_to_vote}

    @property
    def calculated_scores(self):
        scores = []
        for p in self.players:
            if p == self.dasher:
                correct_voters = [p for p in self.votes.values() if p == self.dasher]
                if len(correct_voters) == 0:
                    points = 3
                    details = ["No-one guessed the right answer"]
                else:
                    points = 0
                    details = []
                scores.append({
                    "name": p.name,
                    "points": points,
                    "details": details,
                })
            else:
                ## did i guess the right answer
                correct = self.votes[p] == self.dasher
                votes = self.count_votes(p)
                correct_score = 2 * int(correct)
                ## my votes + 2 points if i got the right answer
                details = []
                if votes > 0:
                    details.append("{} point{} for being voted for".format(votes, "s" if votes != 1 else ""))
                if correct:
                    details.append("2 points for guessing the right answer")
                scores.append({
                    "name": p.name,
                    "points": votes + correct_score,
                    "details": details
                })
        return scores

    def calculate_scores(self):
        self.scores_finalised = True
        for p in self.players:
            p.broadcast("show-scores", self.calculated_scores)

    def set_category(self, category, notify=True):
        self.category = category
        if notify:
            for player in self.players:
                if player != self.dasher:
                    player.broadcast("category-change", category)

    def set_clue(self, clue, notify=True):
        self.clue = clue
        if notify:
            for player in self.players:
                if player != self.dasher:
                    player.broadcast("clue-change", clue)

    def reset(self):
        self._dasher_index = 0
        self.dasher = None
        self.votes = {}
        player_list = [p.name for p in self.players]
        for p in self.players:
            p.broadcast("waiting", player_list)

    def handle_rejoin(self, player):
        """
        After re-joining (e.g. refresh, phone sleeps etc), player needs to be
        brought up to date. This method works out what the player needs to know
        """

        ## rejoining player will receive some basic state info, and a 'next'
        ## message directing their client to the right view
        make_nxt = lambda a, m: {"action": a, "payload": m}

        if self.dasher is not None:
            if self.scores_finalised:
                for p in self.players:
                    return make_nxt("show-scores", self.calculated_scores)
            ## we're in a game
            elif all(a is not None for a in self.answers.values()):
                ## everyone has answered
                if self.dasher == player:
                    return make_nxt("read-answers", self.vote_stage_payload)
                else:
                    return make_nxt("listen-to-reading", None)
            else:
                if self.dasher == player:
                    return make_nxt("dasher", {
                        "responsesReceived": self.answers_received,
                        "answerReceived": self.answers[player.id] is not None,
                        "clue": self.clue,
                        "category": self.category,
                    })
                else:
                    return make_nxt("pls-answer", {
                        "answerReceived": self.answers[player.id] is not None,
                        "clue": self.clue,
                        "category": self.category,
                    })
                if self.answers.get(player.id, None):
                    return make_nxt("got-answer", "")
        else:
            return make_nxt("waiting", [p.name for p in self.players])

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
            if player == self.creator:
                for p in self.players:
                    p.broadcast("error", "creator-left")
                    ## clear up any references to this game, so it gets gc'd
                    p.game = None
                    del Game.registered[self.id]
                    return  # don't reset
            else:
                if player == self.dasher:
                    self.reset()
                else:
                    ## notify all other clients that the player left
                    for p in self.players:
                        p.broadcast("joined", [p.name for p in self.players])
                    ## clear their answer
                    if player.id in self.answers:
                        del self.answers[player.id]

        if len(self.players) == 1:
            self.reset()

    def prep_answers_for_vote(self):
        """
        Shuffle answers and store (retain order)
        """
        clean = []
        for player in self.players:
            if player.id not in self.answers:
                logging.error("Player id not in answers: {} {}".format(player.id, self.answers))
                continue
            clean.append((player, self.answers[player.id]))
        random.shuffle(clean)  # n.b. inplace
        self.shuffled_answers = clean

    def handle_answer(self, player, answer):
        logging.debug("got answer from player " + str(player.id) + ": " + answer)
        assert player in self.players
        self.answers[player.id] = answer
        if all(a is not None for a in self.answers.values()):
            self.prep_answers_for_vote()
            ## round is complete, send answers to dasher
            self.dasher.broadcast("read-answers", self.vote_stage_payload)
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
        self.scores_finalised = False
        self.votes = {}
        self._dasher_index = (self._dasher_index + 1) % len(self.players)
        self.set_clue(None, notify=False)
        self.set_category(None, notify=False)
        for p in self.players:
            if p == self.dasher:
                p.broadcast("dasher", {
                    "responsesReceived": 0,
                    "answerReceived": False,
                    "category": None,
                    "clue": None,
                })
            else:
                p.broadcast("pls-answer", {
                    "answerReceived": False,
                    "category": None,
                    "clue": None,
                })

    def count_votes(self, player):
        votes = [p for v, p in self.votes.items() if p == player and v != p]  # can't self-vote
        return len(votes)

    def add_vote(self, _, payload):
        ## TODO: error handling
        [player_who_voted] = [p for p in self.players if p.name == payload["who"]]
        [player_voted_for] = [p for p in self.players if p.name == payload["votedFor"]]
        self.votes[player_who_voted] = player_voted_for
        self.dasher.broadcast("read-answers", self.vote_stage_payload)
        for p in self.players:
            p.broadcast("votes-for-me", self.count_votes(p))

    def remove_vote(self, _, player_name):
        ## TODO: error handling
        [player] = [p for p in self.players if p.name == player_name]
        del self.votes[player]
        self.dasher.broadcast("read-answers", self.vote_stage_payload)
        for p in self.players:
            p.broadcast("votes-for-me", self.count_votes(p))


class ConnectionHandler(websocket.WebSocketHandler):

    def check_origin(self, origin):
        return True

    def open(self):
        logging.debug("socket opened")
        pass

    def _write_error(self, msg):
        payload = {"action": "error", "payload": msg}
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
