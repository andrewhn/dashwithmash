import React from 'react';
import {
  RaisedButton,
  FlatButton,
  TextField,
  Card,
  CardHeader,
  CardTitle,
  CardText,
  CardActions,
  CircularProgress,
  Dialog,
  SelectField,
  MenuItem,
  Chip,
} from 'material-ui';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import SocketStore from '../stores/SocketStore';
import Actions from '../actions/Actions';

const buttonStyle = {height: "50px"};
const contentStyle = () => {
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: window.innerHeight + "px",
  }
};

const TEMP_ANSWER_KEY = "tmp-answer";

export default class AppContainer extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      name: '',
      game: '',
      stage: 'loading',
      creator: false,
      playerList: [],
      error: {
        open: false,
        title: '',
        content: '',
      },
      leaveDialogOpen: false,
      category: null,
      clue: '',
      answerText: '',
      answerReceived: undefined,
    };

    // binding of this
    this._onNameChange = this._onNameChange.bind(this);
    this._onGameChange = this._onGameChange.bind(this);
    this._onAnswerChange = this._onAnswerChange.bind(this);
    this._onSubmitIdentity = this._onSubmitIdentity.bind(this);
    this._onSubmitAnswer = this._onSubmitAnswer.bind(this);
    this._onSubmitGame = this._onSubmitGame.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onCreate = this._onCreate.bind(this);
    this._onJoin = this._onJoin.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onAddVote = this._onAddVote.bind(this);
    this._onRemoveVote = this._onRemoveVote.bind(this);
    this._onCancelJoin = this._onCancelJoin.bind(this);
    this._onErrorDialogClose = this._onErrorDialogClose.bind(this);
    this._onLogOut = this._onLogOut.bind(this);
    this._onCategoryChange = this._onCategoryChange.bind(this);
    this._onClueChange = this._onClueChange.bind(this);
    this._onLeaveDialogClose = this._onLeaveDialogClose.bind(this);
    this._onLeaveConfirm = this._onLeaveConfirm.bind(this);

    // change listeners
    SocketStore.addChangeListener(this._onMessage);

    // rejoining?
    let playerId = localStorage.getItem('playerId');
    if (playerId) {
      Actions.sendWSData('re-join', playerId);
    } else {
      this.state.stage = 'identify';
    }
  }

  _onMessage() {

    if (SocketStore.requiresReconnect()) {
      let playerId = localStorage.getItem('playerId');
      return Actions.reconnectSocket(playerId);
    }

    const message = SocketStore.getMessage();
    const payload = message.payload;
    let state, tmpAnswer;
    switch (message.action) {
      case 'error':
        switch(payload) {
          case "game-not-found":
            // user typed in this code, so need to inform them code
            // is wrong
            this.setState({
              error: {
                open: true,
                title: 'Game not found',
                content: 'Sorry, we couldn\'t find that game. Did you type the code correctly?',
              }
            })
            break;
          case "player-not-found":
            localStorage.setItem('playerId', '');
            this.setState({stage: 'identify'});
            break;
          case "game-in-progress":
            this.setState({
              error: {
                open: true,
                title: 'Game in progress',
                content: 'Sorry, you can\'t join a game that\'s in progress. To play, you\'ll need to create a new game',
              }
            })
            break;
          case "creator-left":
            this.setState({
              stage: 'initial',
              error: {
                open: true,
                title: 'Game creator left',
                content: 'The game creator left! You\'ll need to start a new game to continue playing',
              }
            })
            break;
        }
        break;
      case 're-joined':
        this.setState({
          name: payload.name,
          game: payload.gameId || '',
          creator: payload.creator,
          playersInGame: payload.players.length,
          playerList: payload.players,
          category: payload.category || '',
          clue: payload.clue || '',
          responsesReceived: payload.responsesReceived,
        });
        if (payload.next) {
          Actions.mockWSData(payload.next);
        } else {
          this.setState({stage: 'initial'})
        }
        break;
      case 'got-name':
        localStorage.setItem('playerId', payload);
        this.setState({stage: 'initial'});
        break;
      case 'created':
        this.setState({
          stage: 'waiting',
          playersInGame: 1,
          game: payload,
        })
        break;
      case 'joined':
        this.setState({
          playersInGame: payload.length,
          playerList: payload,
        });
        break;
      case 'waiting':
        this.setState({
          stage: 'waiting',
          playersInGame: payload.length,
          playerList: payload,
        })
        break;
      case 'dasher':
        tmpAnswer = localStorage.getItem(TEMP_ANSWER_KEY) || "";  // if re-connecting
        this.setState({
          stage: 'dasher',
          answerText: tmpAnswer,
          answerReceived: payload.answerReceived,
          responsesReceived: payload.responsesReceived,
          clue: payload.clue || '',
          category: payload.category || '',
        })
        break;
      case 'pls-answer':
        tmpAnswer = localStorage.getItem(TEMP_ANSWER_KEY) || "";  // if re-connecting
        this.setState({
          stage: 'answering',
          answerText: tmpAnswer,
          answerReceived: payload.answerReceived,
          clue: payload.clue || '',
          category: payload.category || '',
        })
        break;
      case 'got-answer':
        this.setState({answerReceived: true});
        break;
      case 'player-sent-answer':
        this.setState({responsesReceived: payload});
        break;
      case 'read-answers':
        localStorage.setItem(TEMP_ANSWER_KEY, "");
        this.setState({
          stage: "reading",
          playerAnswers: payload.answers,
          toVote: payload.yetToVote,
        })
        break;
      case 'listen-to-reading':
        localStorage.setItem(TEMP_ANSWER_KEY, "");
        this.setState({
          stage: "listen-to-reading",
          myVotes: 0,
        })
        break;
      case 'show-scores':
        this.setState({
          stage: "scoring",
          scoreDetails: payload,
        })
        break;
      case 'category-change':
        this.setState({category: payload || ''});
        break;
      case 'clue-change':
        this.setState({clue: payload || ''});
        break;
      case 'votes-for-me':
        this.setState({myVotes: payload});
        break;
    }
  }

  _onCreate() {
    Actions.sendWSData('create', '');
    this.setState({
      creator: true,
      playerList: [this.state.name],
    })
  }

  _onJoin() {
    localStorage.removeItem(TEMP_ANSWER_KEY);
    this.setState({
      stage: 'join',
      creator: false,
    });
  }

  _onCancelJoin() {
    this.setState({
      stage: 'initial',
    })
  }

  _onStart() {
    Actions.sendWSData('start', '');
  }

  _onCalculateScores() {
    Actions.sendWSData('calculate-scores', '');
  }

  _onSubmitIdentity() {
    Actions.sendWSData('identify', this.state.name);
  }

  _onSubmitGame() {
    Actions.sendWSData('join', this.state.game);
  }

  _onSubmitAnswer() {
    Actions.sendWSData('answer', this.state.answerText);
  }

  _onAnswerChange(evt, value) {
    localStorage.setItem(TEMP_ANSWER_KEY, value);
    this.setState({answerText: value});
  }

  _onNameChange(evt, value) {
    this.setState({name: value})
  }

  _onGameChange(evt, value) {
    this.setState({game: value})
  }

  _onLeaveConfirm() {
    Actions.sendWSData("leave", "");
    this.setState({
      game: "",
      stage: "initial",
      leaveDialogOpen: false,
    });
  }

  _onLeave() {
    this.setState({
      leaveDialogOpen: true,
    });
  }

  _onLeaveDialogClose() {
    this.setState({
      leaveDialogOpen: false,
    });
  }

  _onErrorDialogClose() {
    this.setState({
      error: {
        open: false,
        title: '',
        content: '',
      }
    })
  }

  _onLogOut() {
    localStorage.removeItem('playerId');
    this.setState({
      stage: 'identify',
      name: '',
    });
  }

  _onCategoryChange(evt, idx, value) {
    this.setState({category: value});
    Actions.sendWSData("category-change", value);
  }

  _onAddVote(votedFor, evt, idx, whoVoted) {
    // value := username of vote for
    Actions.sendWSData("add-vote", {who: whoVoted, votedFor: votedFor});
  }

  _onRemoveVote(votedFor) {
    Actions.sendWSData("remove-vote", votedFor);
  }

  _onClueChange(evt, value) {
    this.setState({clue: value});
    setTimeout(() => {
      if (value == this.state.clue) {
        // check if user has finished typing (300ms)
        Actions.sendWSData("clue-change", value);
      }
    }, 300);
  }

  render() {
    let content;
    switch(this.state.stage) {
      case 'loading':
        content = <div style={contentStyle()}>
          <CircularProgress size={80} thickness={5} />
        </div>;
        break;
      case 'identify':
        content = <div style={contentStyle()}>
            <div style={{width: "100%"}}>
              <p style={{textAlign: "center", fontSize: "24px"}}>dashwithmash.com</p>
              <p style={{textAlign: "center", paddingLeft: "30px", paddingRight: "30px"}}>
                Enter your name below to get started
              </p>
              <div style={{paddingLeft: "10px", paddingRight: "10px"}}>
                <TextField fullWidth={true}
                           id="name-input"
                           floatingLabelText="Name"
                           value={this.state.name}
                           onChange={this._onNameChange} />
              </div>
              <RaisedButton label="Done" primary={true} fullWidth={true} onClick={this._onSubmitIdentity}/>
            </div>
          </div>;
          setTimeout(() => {
            const elt = document.getElementById("name-input");
            if (elt) elt.focus();
          }, 300);
          break;
      case 'initial':
        content = <div style={contentStyle()}>
          <div style={{width: "100%", marginTop: "auto", marginBottom: "auto"}}>
            <p style={{textAlign: 'center', fontSize: '24px'}}>Hello, {this.state.name}</p>
            <RaisedButton label="Create a game" primary={true} fullWidth={true} onClick={this._onCreate}/>
            <RaisedButton label="Join a game" secondary={true} fullWidth={true} onClick={this._onJoin}/>
          </div>
          <RaisedButton label="Log out" fullWidth={true} onClick={this._onLogOut}/>
        </div>;
        break;
      case 'waiting':
        let startButton;
        if (this.state.creator) {
          startButton = <RaisedButton label="Start game!" primary={true} fullWidth={true} onClick={this._onStart} />;
        }
        content = <div style={contentStyle()}>
          <div style={{alignSelf: 'flex-start', width: "100%"}}>
            <RaisedButton label="Leave!" secondary={true} fullWidth={true} onClick={this._onLeave} />
          </div>
          <div style={{width: "100%", marginTop: "auto", marginBottom: "auto"}}>
            <div style={{padding: "10px"}}>
              <p style={{textAlign: 'center'}}>Game code is</p>
              <p style={{textAlign: 'center', fontSize: "30px"}}>{this.state.game}</p>
              <p style={{textAlign: 'center'}}>Waiting for other players to join (currently {this.state.playersInGame})</p>
              <hr />
              {this.state.playerList.map((p, i) => {
                const style = {
                  textAlign: 'center',
                  margin: "0px",
                  padding: "0px",
                  lineHeight: "20px",
                  fontSize: "18px",
                }
                return <p style={style} key={i}>{p}</p>;
              })}
            <hr />
            </div>
            {startButton}
          </div>
        </div>
        break;
      case 'join':
        content = <div style={contentStyle()}>
          <div style={{paddingLeft: "40px", paddingRight: "40px", textAlign: "center"}}>
            Enter a game code someone else has created below (case insensitive)
          </div>
          <div style={{paddingLeft: "10px", paddingRight: "10px", width: "100%"}}>
            <TextField fullWidth={true}
                       id="game-code-input"
                       floatingLabelText="Game code"
                       value={this.state.game}
                       onChange={this._onGameChange} />
          </div>
          <RaisedButton label="Done" primary={true} fullWidth={true} onClick={this._onSubmitGame}/>
          <RaisedButton label="Cancel" secondary={true} fullWidth={true} onClick={this._onCancelJoin}/>
        </div>;
        setTimeout(() => {
          const elt = document.getElementById("game-code-input");
          if (elt) elt.focus();
        }, 300);
        break;
      case 'dasher':
        content = <div style={contentStyle()}>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{marginTop: "auto", marginBottom: "auto", width: "100%"}}>
            <div style={{padding: "10px"}}>
              <p style={{textAlign: 'center', fontSize: "30px"}}>Dasher!</p>
              <p style={{textAlign: 'center'}}>Waiting for players to submit their answers</p>
              <p style={{textAlign: 'center'}}>{this.state.responsesReceived} of {this.state.playersInGame} so far ... </p>
              <p style={{textAlign: 'center'}}>In the meantime, fill out the details below</p>
              <SelectField floatingLabelText="Category"
                           value={this.state.category}
                           fullWidth={true}
                           onChange={this._onCategoryChange} >
                <MenuItem value="Word" primaryText="Word" />
                <MenuItem value="Person" primaryText="Person" />
                <MenuItem value="Acronym" primaryText="Acronym" />
                <MenuItem value="Film" primaryText="Film" />
                <MenuItem value="Date" primaryText="Date" />
              </SelectField>
              <TextField fullWidth={true}
                         id="dasher-clue-input"
                         floatingLabelText={this.state.category ? this.state.category + ' (clue)' : 'Clue'}
                         value={this.state.clue}
                         onChange={this._onClueChange} />
              <TextField fullWidth={true}
                         id="dasher-answer"
                         floatingLabelText="Correct answer"
                         multiLine={true}
                         value={this.state.answerText}
                         onChange={this._onAnswerChange} />
            </div>
            <RaisedButton label="Done"
                          primary={true}
                          fullWidth={true}
                          onClick={this._onSubmitAnswer}
                          disabled={this.state.answerText.length == 0} />
            <p style={{textAlign: "center"}}>{this.state.answerReceived ? 'Got the answer - you can edit it until everyone has finished' : ''}</p>
          </div>
        </div>;
        break;
      case 'answering':
        let category, clue;
        if (this.state.category) {
          category = <p style={{fontSize: "24px", textAlign: "center"}}>{this.state.category}</p>;
        }
        if (this.state.clue) {
          clue = <p style={{fontSize: "18px", textAlign: "center"}}>"{this.state.clue}"</p>;
        }
        content = <div style={contentStyle()}>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{marginTop: "auto", marginBottom: "auto", width: "100%"}}>
            {category}
            {clue}
            <div style={{padding: "10px"}}>
              <TextField multiLine={true} fullWidth={true}
                         floatingLabelText="Answer"
                         value={this.state.answerText}
                         onChange={this._onAnswerChange}></TextField>
            </div>
            <RaisedButton label="Done"
                          disabled={this.state.answerText.length == 0}
                          primary={true}
                          fullWidth={true}
                          onClick={this._onSubmitAnswer} />
            <p style={{textAlign: "center"}}>{this.state.answerReceived ? 'Got your answer - you can change it until everyone has finished' : ''}</p>
          </div>
        </div>;
        break;
      case 'reading':
        content = <div>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{width: "100%", height: "30px"}}></div>
          <div style={{padding: "10px"}}>
            {this.state.playerAnswers.map((answer, i) => {
              return <Card key={i}>
                <CardTitle title={answer.name} subtitle={answer.votes.length + " vote" + (answer.votes.length === 1 ? "" : "s")} />
                <CardText>{answer.answer}</CardText>

                <div style={{marginLeft: "15px", marginRight: "15px"}}>
                  {answer.votes.map((v, i) => {
                    return <Chip onRequestDelete={this._onRemoveVote.bind(null, v)} key={i}>{v}</Chip>
                  })}
                </div>

                <CardActions>
                  {this.state.toVote.length === 0 ? <div></div> :
                    <SelectField floatingLabelText="Add vote"
                                 fullWidth={true}
                                 disabled={this.state.toVote.length === 0}
                                 onChange={this._onAddVote.bind(null, answer.name)} >
                      {this.state.toVote.map((p, i) => <MenuItem key={i} value={p} primaryText={p} />)}
                    </SelectField>
                  }
                </CardActions>
              </Card>;
            })}
          </div>
          <div style={{width: "100%", height: "30px"}}></div>
          <RaisedButton label="Calculate scores"
                        primary={true}
                        fullWidth={true}
                        disabled={this.state.toVote.length !== 0}
                        onClick={this._onCalculateScores} />
        </div>
        break;
      case 'listen-to-reading':
        content = <div>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
            <div style={{padding: "10px"}}>
              <div style={{paddingTop: window.innerHeight / 2 - 80, width: "100%"}}></div>
              <p style={{textAlign: "center", fontSize: "18px"}}>Listen to the answers and vote!</p>
              <p style={{textAlign: "center"}}>Your votes:</p>
              <p style={{textAlign: "center", fontSize: "36px"}}>{this.state.myVotes}</p>
            </div>
          </div>;
          break;
      case 'scoring':
        content = <div>
          <RaisedButton label={"Leave " + this.state.game} secondary={true} fullWidth={true} onClick={this._onLeave}/>
          <div style={{padding: "10px"}}>
            <h2>Scores</h2>
            {this.state.scoreDetails.map((sd, i) => {
              return <Card key={i}>
                <CardTitle title={sd.name} subtitle={sd.points + " point" + (sd.points === 1 ? "" : "s")} />
                <CardText>
                  {sd.details.map((d, i) => {
                    return <p key={i + "_d"}>{d}</p>
                  })}
                </CardText>
              </Card>
            })}
          </div>
        <RaisedButton label="Next round" primary={true} fullWidth={true} onClick={this._onStart} />
        </div>
        break;
    }

    const errorDialogActions = [
      <FlatButton label="Close" primary={true} onClick={this._onErrorDialogClose} />,
    ];

    const leaveDialogActions = [
      <FlatButton label="Cancel" secondary={true} onClick={this._onLeaveDialogClose} />,
      <FlatButton label="Leave" primary={true} onClick={this._onLeaveConfirm} />,
    ];

    return <MuiThemeProvider>
      <div>

        {content}

        <Dialog title={this.state.error.title}
                actions={errorDialogActions}
                modal={false}
                open={this.state.error.open}
                onRequestClose={this._onErrorDialogClose} >
          {this.state.error.content}
        </Dialog>

        <Dialog title="Are you sure"
                actions={leaveDialogActions}
                modal={false}
                open={this.state.leaveDialogOpen}
                onRequestClose={this._onLeaveDialogClose} >
            <p>Are you sure you want to leave the game?</p>
        </Dialog>
      </div>
    </MuiThemeProvider>;
  }

};

