/** Общая для inline-сканов граница одновременно открытых файлов. */
export class ScanGate {
  private active=0
  private queue:Array<()=>void>=[]
  constructor(private readonly limit:number){if(!Number.isInteger(limit)||limit<1)throw new Error("Invalid scan limit")}
  run<T>(task:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    return new Promise((resolve,reject)=>{
      let started=false
      const abort=()=>{
        if(started)return
        const index=this.queue.indexOf(start)
        if(index>=0)this.queue.splice(index,1)
        signal?.removeEventListener("abort",abort)
        reject(signal?.reason??new DOMException("Aborted","AbortError"))
      }
      const start=()=>{
        started=true;signal?.removeEventListener("abort",abort)
        if(signal?.aborted){reject(signal.reason);this.drain();return}
        this.active++
        void Promise.resolve().then(task).then(resolve,reject).finally(()=>{this.active--;this.drain()})
      }
      if(signal?.aborted){reject(signal.reason);return}
      this.queue.push(start);signal?.addEventListener("abort",abort,{once:true});this.drain()
    })
  }
  private drain(){while(this.active<this.limit&&this.queue.length)this.queue.shift()!()}
}
