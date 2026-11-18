import {BoundedCache} from "./bounded-cache"
export type ContentUiSnapshot={search:string;page:number;selected:string[];scrollTop?:number}
/** Только UI-значения, без BuildMod/описаний/картинок/замыканий операции. */
const state=new BoundedCache<string,ContentUiSnapshot>({capacity:32,maxWeight:128*1024,ttlMs:60*60_000,weight:value=>value.search.length*2+value.selected.reduce((sum,id)=>sum+id.length*2,0)+128})
export const readContentUi=(key:string)=>state.get(key)
export const saveContentUi=(key:string,value:ContentUiSnapshot)=>state.set(key,value)
