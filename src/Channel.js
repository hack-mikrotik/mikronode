import util from 'util';
import events from 'events';
import {Observable, Subject, Scheduler} from 'rxjs';
import {DEBUG, CONNECTION, CHANNEL, EVENT} from './constants.js';

export default class Channel extends events.EventEmitter {

    @Private
    id;

    @Private
    status=CHANNEL.OPEN;

    @Private
    closed=false;

    @Private
    stream;

    @Private
    debug=DEBUG.NONE;

    @Private
    closeOnDone=false;

    @Private
    closeOnTrap=false;

    @Private
    bufferedStream;

    @Private
    data;

    @Private
    read;

    @Private
    trap;

    constructor(id,stream,debug,closeOnDone) {
        super();
        this.debug=debug;
        this.debug&DEBUG.SILLY&&console.log('Channel::New');
        this.closeOnDone=closeOnDone;
        // if(this.status&(CHANNEL.CLOSING|CHANNEL.CLOSED)) return;
        const done=new Subject();
        const index=done
            .subscribeOn(Scheduler.async)
            .scan((idx,i)=>++idx,0)
            .share(); // share the index result.

        this.stream=stream;
        this.id=id;
        this.read=stream.read.takeWhile(()=>!(this.status&(CHANNEL.CLOSING|CHANNEL.CLOSED)))
            .do(e=>{
                console.log(e);
                this.debug>=DEBUG.DEBUG&&console.log('Channel (%s)::Event (%s)',id,e.type);
                if (e.type==EVENT.DONE_TAG||e.type==EVENT.DONE||e.type==EVENT.DONE_RET) {
                    this.debug>=DEBUG.DEBUG&&console.log('Channel (%s)::Triggering Done',id);
                    this.status=CHANNEL.DONE;
                    if (this.closeOnDone) {
                        this.status=CHANNEL.CLOSING;
                        this.debug>=DEBUG.DEBUG&&console.log('Channel (%s)::CLOSING',id);
                    }
                    done.next("go");
                } else
                if (e.type==EVENT.TRAP && this.closeOnTrap) {
                    this.status=CHANNEL.CLOSING;
                    this.debug>=DEBUG.DEBUG&&console.log('Channel (%s)::CLOSING',id);
                    done.complete();
                    this.close();
                } else
                if (e.type==EVENT.FATAL) {
                    this.status=CHANNEL.CLOSED;
                    this.debug>=DEBUG.INFO&&console.log('Channel (%s)::CLOSING',id);
                    done.complete();
                    this.close();
                }
            });

        this.trap=this.read.filter(e=>e.type===EVENT.TRAP_TAG||e.type===EVENT.TRAP);

        this.data=this.read
            .filter(e=>e.type===EVENT.DATA||e.type===EVENT.DONE_RET)
            .do(e=>this.debug>=DEBUG.DEBUG&&console.log('Channel (%s)::DATA ',id,e))
            .do(data=>this.emit(EVENT.DATA,data.data));

        this.bufferedStream=this.data
            .buffer(index)
            .map(d=>({id:id,type:EVENT.DONE,data:d.map(d=>d.data)}))
            // .combineLatest(index,(buffer,index)=>({...buffer,index}));

        this.bufferedStream
            .subscribe(buffer=>{
                this.debug>=DEBUG.INFO&&console.log('Channel(%s)::DONE (%s)',id);
                this.emit(EVENT.DONE,buffer);
                if (this.status&CHANNEL.CLOSING||this.stream.done()) {
                    this.debug>=DEBUG.SILLY&&console.log("Channel (%s) closing",id);
                    this.close();
                }
            });
    }

    write(d,args) {
        if (this.status&(CHANNEL.CLOSED|CHANNEL.CLOSING)) {
            this.status>=DEBUG.WARN&&console.log("Cannot write on closed or closing channel");
            return this;
        }
        this.status=CHANNEL.RUNNING;
        this.debug>=DEBUG.INFO&&console.log("Writing on channel %s",this.id,d);
        this.stream.write(d,args);
        return this;
    }

    // status() { return this.status }
    close() { 
        if (this.status==CHANNEL.CLOSED) return;
        this.status=CHANNEL.CLOSED;
        this.debug>=DEBUG.INFO&&console.log('Channel (%s)::CLOSED',this.id);
        this.stream.close();
        this.removeAllListeners(EVENT.DONE);
        this.removeAllListeners(EVENT.DATA);
        this.removeAllListeners(EVENT.TRAP);
    }
    // Enforce read-only

    /** Data stream returns each sentence from the device as it is received. **/
    get data() {
        return this.data;
    }

    /** Done stream buffers every sentence and returns all sentences at once.
        Don't use this stream when "listen"ing to data. done ever comes.
        A trap signals the end of the data of a listen command.
     **/
    get done() {
        return this.bufferedStream;
    }

    /** When a trap occurs, the trap sentence flows through this stream **/
    get trap() {
        // TRAP_TAG is the only one that *should* make it here.
        return this.trap;
    }

    /** This is the raw stream. Everything for this channel comes through here. **/
    get stream() {
        return this.read;
    }

    get status() {
        return this.status;
    }

    pipeFrom(stream$) {
        if (this.status&(CHANNEL.DONE|CHANNEL.OPEN)) {
            this.status=CHANNEL.RUNNING;
            stream$.subscribe(
                d=>this.write(d),
                ()=>{
                    this.status=CHANNEL.DONE;
                    this.stream.done();
                },
                ()=>{
                    this.status=CHANNEL.DONE;
                    this.stream.done();
                }
            );
        }
    }
    getId(){return this.id}
    /** When the done sentence arrives, close the channel. **/
    closeOnDone(b) { return typeof(b)=='boolean'?this.closeOnDone=b:this.closeOnDone; }

    /** If trap occurs, consider it closed. **/
    closeOnTrap(b)  { return typeof(b)=='boolean'?this.closeOnTrap=b:this.closeOnTrap; }

}